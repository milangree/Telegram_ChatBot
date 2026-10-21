// functions/api/routes/auth.js
// 认证相关路由（公开）
import { DB } from '../../_shared/db.js';
import { TG } from '../../_shared/tg.js';
import {
  hashPw, verifyPw, createSession, getSession, delSession,
  validatePassword, isLegacyPasswordHash, fuzzRetryTime,
  extractToken, checkAuthRateLimit, recordAuthFailure, clearAuthFailures,
  verifyInitData, getClientIp, timingSafeEqualStr,
} from '../../_shared/auth.js';
import {
  ensureAdminInitializedOnce, getBootstrapStatus, isBootstrapAdminDisabled,
  registerInitialAdmin, adoptBootstrapAdmin, BootstrapError,
} from '../../_shared/admin-bootstrap.js';
import { verifyTOTP, generateTOTPSecret } from '../../_shared/totp.js';
import { renderCaptchaPNG } from '../../_shared/captcha.js';
import { setupMiniAppMenu, DEPLOY_VERSION } from '../../_shared/bot.js';
import { getOrCreateThread } from '../../_shared/bot-thread.js';
import { normalizeBotLocale, createBotT } from '../../_shared/bot-i18n.js';
import { createT, normalizeLocale } from '../../../shared/i18n.js';
import {
  CORS, j, err, getApiTranslator, getLoginSessionTtl,
  parseAdminIds, cookie, isSecureRequest, escapeHtml,
} from '../../_shared/api-utils.js';
import { logError, silentCatch } from '../../_shared/error-handler.js';

/**
 * 处理认证相关路由
 * @returns {Response|null} null 表示不匹配，继续下一个路由
 */
export async function handleAuthRoutes(path, request, ctx) {
  const { db, kv, waitUntil } = ctx;
  const t = ctx.t;

  // ── 公开路由 ──────────────────────────────────────────────────────────

  if (path === '/auth/status' && request.method === 'GET') {
    const status = await getBootstrapStatus({ db, kv }).catch(() => ({ state: 'error', needsRegistration: false }));
    return j({ needsRegistration: status.needsRegistration });
  }

  if (path === '/auth/register' && request.method === 'POST') {
    return handleRegister(request, ctx);
  }

  if (path === '/auth/login' && request.method === 'POST') {
    return handleLogin(request, ctx);
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const token = extractToken(request);
    if (token) await delSession(kv, token);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie('', 0, { secure: isSecureRequest(request) }) },
    });
  }

  if (path === '/auth/me' && request.method === 'GET') {
    const token = extractToken(request);
    if (!token) return err(t('auth.unauthorized'), 401);
    const sess = await getSession(kv, token);
    if (!sess) return err(t('auth.sessionExpired'), 401);
    const user = await db.getWebUserById(sess.userId);
    if (!user) return err(t('auth.userNotFound'), 401);
    if (await isBootstrapAdminDisabled({ kv, user })) return err(t('auth.unauthorized'), 401);
    return j({ username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) });
  }

  // 历史兼容：不再泄露用户是否存在 / 是否启用 2FA，恒定返回 false
  if (path === '/auth/totp-status' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const ip = getClientIp(request);
      const rateId = { ip, username: body?.username };
      const rate = await checkAuthRateLimit(kv, 'totpStatus', rateId);
      if (!rate.allowed) {
        return err(t('auth.tooManyAttempts', { seconds: fuzzRetryTime(rate.retryAfterSec) }), 429);
      }
      await recordAuthFailure(kv, 'totpStatus', rateId);
    } catch { /* noop */ }
    return j({ totpEnabled: false });
  }

  if (path === '/auth/recover' && request.method === 'POST') {
    return handleRecover(request, ctx);
  }

  // 验证码图片（公开）
  const capMatch = path.match(/^\/captcha\/([a-f0-9]+)$/);
  if (capMatch && request.method === 'GET') {
    const text = await kv.get(`captcha_render:${capMatch[1]}`);
    if (!text) return new Response(t('captcha.notFound'), { status: 404 });
    const png = await renderCaptchaPNG(text, capMatch[1]);
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store, private', ...CORS } });
  }

  // Web 验证页面（公开）— Turnstile / reCAPTCHA / hCaptcha
  const webVerifyMatch = path.match(/^\/verify\/([a-f0-9]+)$/);
  if (webVerifyMatch) {
    return handleWebVerify(webVerifyMatch[1], request, ctx);
  }

  return null; // 不匹配
}

// ── 内部处理函数 ──────────────────────────────────────────────────────────

async function handleRegister(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const status = await getBootstrapStatus({ db, kv });
    if (!status.needsRegistration) return err(t('auth.registrationClosed'), 403);
    const { username, password } = await request.json();
    if (typeof username !== 'string' || typeof password !== 'string') return err(t('common.missingParams'));
    if (!username || !password) return err(t('common.missingParams'));
    if (username.length < 3) return err(t('auth.usernameMin'));
    if (!validatePassword(password)) return err(t('auth.passwordMin'));

    let bootstrapUserId = null;
    const bootstrapTokenValue = extractToken(request);
    if (bootstrapTokenValue) {
      const bootstrapSession = await getSession(kv, bootstrapTokenValue);
      if (bootstrapSession) {
        const bootstrapUser = await db.getWebUserById(bootstrapSession.userId);
        if (bootstrapUser && !(await isBootstrapAdminDisabled({ kv, user: bootstrapUser }))) {
          bootstrapUserId = bootstrapUser.id;
        }
      }
    }

    const user = await registerInitialAdmin({ db, kv, username, password, bootstrapUserId });
    const sessionTtl = await getLoginSessionTtl(db);
    const token = await createSession(kv, user.id, sessionTtl);
    return new Response(JSON.stringify({ username: user.username, isAdmin: true }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl, { secure: isSecureRequest(request) }) },
    });
  } catch (e) {
    console.error('[API Error] auth.registerFailed:', e?.message || e);
    const status = e instanceof BootstrapError ? e.status || 500 : 500;
    if (e instanceof BootstrapError && e.message) return err(e.message, status);
    return err(t('auth.registerFailed'), status);
  }
}

async function handleLogin(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  const parsedBody = await request.json().catch(() => ({}));

  // 检测 Telegram Web App 登录（带 initData）
  if (parsedBody.initData && !parsedBody.username) {
    return handleTelegramLogin(parsedBody.initData, request, ctx);
  }

  try {
    const { username, password, totp } = parsedBody;
    if (typeof username !== 'string' || typeof password !== 'string') {
      const ip = getClientIp(request);
      await recordAuthFailure(kv, 'login', { ip, username }).catch(() => {});
      return err(t('auth.invalidCredentials'), 401);
    }
    const ip = getClientIp(request);
    const rateId = { ip, username };

    if (parsedBody.loginMode === 'totp_only') {
      return err(t('auth.missingPassword'), 400);
    }

    const rate = await checkAuthRateLimit(kv, 'login', rateId);
    if (!rate.allowed) {
      return err(t('auth.tooManyAttempts', { seconds: fuzzRetryTime(rate.retryAfterSec) }), 429);
    }

    const user = await db.getWebUser(username);
    if (!user) {
      await recordAuthFailure(kv, 'login', rateId);
      return err(t('auth.invalidCredentials'), 401);
    }

    if (await isBootstrapAdminDisabled({ kv, user })) {
      await recordAuthFailure(kv, 'login', rateId);
      return err(t('auth.invalidCredentials'), 401);
    }

    if (!password) return err(t('auth.missingPassword'));
    if (!await verifyPw(password, user.password_hash)) {
      await recordAuthFailure(kv, 'login', rateId);
      return err(t('auth.invalidCredentials'), 401);
    }
    if (user.totp_enabled) {
      if (!totp) {
        return err(t('auth.totpRequired'), 401);
      }
      if (!await verifyTOTP(totp, user.totp_secret, { kv, userId: user.id })) {
        await recordAuthFailure(kv, 'login', rateId);
        return err(t('auth.invalidTotp'), 401);
      }
    }

    await clearAuthFailures(kv, 'login', rateId);
    if (isLegacyPasswordHash(user.password_hash)) {
      try {
        await db.updateWebUserPassword(user.id, await hashPw(password));
      } catch (e) {
        console.error('[API] legacy password rehash failed:', e?.message || e);
      }
    }

    try {
      const status = await getBootstrapStatus({ db, kv });
      if (status?.needsRegistration && status?.defaultAdminId === user.id) {
        await adoptBootstrapAdmin({ db, kv, userId: user.id });
      }
    } catch (e) {
      console.error('[API] adopt bootstrap on login failed:', e?.message || e);
    }

    const sessionTtl = await getLoginSessionTtl(db);
    const token = await createSession(kv, user.id, sessionTtl);
    return new Response(JSON.stringify({ username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl, { secure: isSecureRequest(request) }) },
    });
  } catch (e) {
    console.error('[API Error] auth.loginFailed:', e.message);
    return err(t('auth.loginFailed'), 500);
  }
}

async function handleRecover(request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const { username, totp, newPassword } = await request.json();
    if (typeof username !== 'string' || typeof newPassword !== 'string' || typeof totp !== 'string') return err(t('common.missingParams'));
    if (!username || !newPassword || !totp) return err(t('common.missingParams'));
    if (!validatePassword(newPassword)) return err(t('auth.passwordMin'));

    const ip = getClientIp(request);
    const rateId = { ip, username };
    const rate = await checkAuthRateLimit(kv, 'recover', rateId);
    if (!rate.allowed) {
      return err(t('auth.tooManyAttempts', { seconds: fuzzRetryTime(rate.retryAfterSec) }), 429);
    }

    const user = await db.getWebUser(username);
    if (!user || !user.totp_enabled || await isBootstrapAdminDisabled({ kv, user })) {
      await recordAuthFailure(kv, 'recover', rateId);
      return err(t('auth.invalidCredentials'), 401);
    }

    if (!await verifyTOTP(totp, user.totp_secret, { kv, userId: user.id })) {
      await recordAuthFailure(kv, 'recover', rateId);
      return err(t('auth.invalidTotp'), 401);
    }

    const { rotatePasswordAndRevokeSessions } = await import('../../_shared/auth.js');
    await rotatePasswordAndRevokeSessions({ db, kv, userId: user.id, newPassword });
    await clearAuthFailures(kv, 'recover', rateId);
    return j({ ok: true });
  } catch {
    return err(t('auth.recoverFailed'), 500);
  }
}

async function handleTelegramLogin(initData, request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  try {
    const ip = getClientIp(request);
    const initRate = await checkAuthRateLimit(kv, 'login', { ip });
    if (!initRate.allowed) {
      return err(t('auth.tooManyAttempts', { seconds: fuzzRetryTime(initRate.retryAfterSec) }), 429);
    }

    const botToken = await db.getSetting('BOT_TOKEN');
    if (!botToken) return err(t('kvNotBound'), 500);

    const verified = await verifyInitData(initData, botToken, 3600);
    if (!verified || !verified.user || !verified.user.id) return err(t('auth.invalidCredentials'), 401);

    const tgId = Number(verified.user.id);
    const adminIds = parseAdminIds(await db.getSetting('ADMIN_IDS'));
    if (!adminIds.includes(tgId)) return err(t('auth.forbidden'), 403);

    const allWebUsers = await db.getAllWebUsersRaw();
    const adminUsers = allWebUsers.filter((u) => u.is_admin === 1 || u.is_admin === true || u.is_admin === '1');
    const availableAdmins = [];
    for (const u of adminUsers) {
      if (!(await isBootstrapAdminDisabled({ kv, user: u }))) availableAdmins.push(u);
    }
    if (availableAdmins.length === 0) {
      return err(t('auth.noAvailableAdmin'), 403);
    }
    availableAdmins.sort((a, b) => Number(a.id) - Number(b.id));
    const webUser = availableAdmins[0];

    const sessionTtl = await getLoginSessionTtl(db);
    const token = await createSession(kv, webUser.id, sessionTtl);
    return new Response(JSON.stringify({ username: webUser.username, isAdmin: true }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl, { secure: isSecureRequest(request) }) },
    });
  } catch (e) {
    console.error('[telegram login]', e?.message || e);
    return err(t('auth.loginFailed'), 500);
  }
}

async function handleWebVerify(webVerifyId, request, ctx) {
  const { db, kv, waitUntil } = ctx;
  const t = ctx.t;
  const url = new URL(request.url);
  const webVerifyRaw = await kv.get(`webverify:${webVerifyId}`);

  if (request.method === 'POST') {
    if (!webVerifyRaw) return j({ ok: false, error: 'expired' }, 404);
    const { userId, captchaType } = JSON.parse(webVerifyRaw);

    const verifyRecord = await db.getVerify(userId).catch(() => null);
    if (!verifyRecord || verifyRecord.expires_at < Date.now()) {
      return j({ ok: false, error: 'expired' }, 410);
    }

    const body = await request.json().catch(() => ({}));
    const captchaResponse = body['cf-turnstile-response'] || body['g-recaptcha-response'] || body['h-captcha-response'] || '';
    if (!captchaResponse) return j({ ok: false, error: 'missing_captcha' }, 400);

    let verifyResult = false;
    if (captchaType === 'hcaptcha') {
      const secretKey = await db.getSetting('HCAPTCHA_SECRET_KEY');
      if (!secretKey) return j({ ok: false, error: 'not_configured' }, 500);
      const formData = new URLSearchParams({ secret: secretKey, response: captchaResponse });
      try {
        const resp = await fetch('https://api.hcaptcha.com/siteverify', { method: 'POST', body: formData });
        const result = await resp.json();
        verifyResult = result.success === true;
      } catch { verifyResult = false; }
    } else if (captchaType === 'turnstile') {
      const secretKey = await db.getSetting('TURNSTILE_SECRET_KEY');
      if (!secretKey) return j({ ok: false, error: 'not_configured' }, 500);
      const formData = new URLSearchParams({ secret: secretKey, response: captchaResponse });
      try {
        const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: formData });
        const result = await resp.json();
        verifyResult = result.success === true;
      } catch { verifyResult = false; }
    } else if (captchaType === 'recaptcha' || captchaType === 'recaptcha_v3') {
      const secretKey = captchaType === 'recaptcha_v3'
        ? await db.getSetting('RECAPTCHA_V3_SECRET_KEY')
        : await db.getSetting('RECAPTCHA_SECRET_KEY');
      if (!secretKey) return j({ ok: false, error: 'not_configured' }, 500);
      const formData = new URLSearchParams({ secret: secretKey, response: captchaResponse });
      try {
        const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: formData });
        const result = await resp.json();
        if (captchaType === 'recaptcha_v3') {
          const threshold = parseFloat(await db.getSetting('RECAPTCHA_V3_SCORE_THRESHOLD') || '0.5');
          verifyResult = result.success === true && (result.score || 0) >= threshold;
        } else {
          verifyResult = result.success === true;
        }
      } catch { verifyResult = false; }
    }

    if (!verifyResult) return j({ ok: false, error: 'captcha_failed' }, 400);

    await db.setUserVerified(userId, true);

    const bgTask = (async () => {
      try {
        const botToken = await db.getSetting('BOT_TOKEN').catch(() => '');
        if (!botToken) return;
        const tg = new TG(botToken);
        const wvData = JSON.parse(webVerifyRaw);
        const verifyMsgId = wvData.verifyMsgId || verifyRecord?.verify_msg_id;

        await db.delVerify(userId).catch(() => {});
        await kv.delete(`webverify:${webVerifyId}`).catch(() => {});

        if (verifyMsgId) {
          const del = await tg.deleteMsg({ chatId: userId, msgId: verifyMsgId }).catch(() => null);
          if (!del?.ok) {
            const ed = await tg.editText({ chatId: userId, msgId: verifyMsgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
            if (!ed?.ok) await tg.editCaption({ chatId: userId, msgId: verifyMsgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
          }
        }

        const locale = normalizeBotLocale(await db.getSetting('BOT_LOCALE').catch(() => 'zh-hans'));
        const botT = createBotT(locale);
        await tg.sendMsg({ chatId: userId, text: botT('verify.success') }).catch(() => {});

        const pendingRaw = await kv.get(`pending:${userId}`).catch(() => null);
        if (pendingRaw) {
          await kv.delete(`pending:${userId}`).catch(() => {});
          try {
            const p = JSON.parse(pendingRaw);
            const groupId = parseInt(await db.getSetting('FORUM_GROUP_ID').catch(() => '0'), 10);
            if (groupId && p.msgId) {
              const realUser = await db.getUser(userId).catch(() => null);
              const threadUser = realUser || { id: userId, first_name: '' };
              const tid = await getOrCreateThread(tg, db, threadUser, groupId, kv, botT);
              if (tid) {
                await tg.copyMsg({ chatId: groupId, fromChatId: userId, msgId: p.msgId, threadId: tid });
                await db.addMsg({ userId, direction: 'incoming', content: 'verified-forwarded' });
                await tg.sendMsg({ chatId: userId, text: botT('sentAfterVerify') }).catch(() => {});
              }
            }
          } catch (e) {
            console.error('[api/verify] forward pending failed:', e);
          }
        }
      } catch (e) {
        console.error('[api/verify] background task failed:', e);
      }
    })();

    if (waitUntil) waitUntil(bgTask);
    else bgTask.catch(() => {});

    return j({ ok: true });
  }

  // GET /api/verify/{token} — 返回验证页面
  if (request.method === 'GET') {
    if (!webVerifyRaw) {
      return new Response(buildVerifyPage(null, null, 'expired', url.origin, null), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    const { userId: wvUserId, captchaType } = JSON.parse(webVerifyRaw);
    const verifyRecord = await db.getVerify(wvUserId).catch(() => null);
    if (!verifyRecord || verifyRecord.expires_at < Date.now()) {
      await kv.delete(`webverify:${webVerifyId}`).catch(() => {});
      return new Response(buildVerifyPage(null, null, 'expired', url.origin, null), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    const siteKeySetting = captchaType === 'turnstile' ? 'TURNSTILE_SITE_KEY'
      : captchaType === 'recaptcha_v3' ? 'RECAPTCHA_V3_SITE_KEY'
      : captchaType === 'hcaptcha' ? 'HCAPTCHA_SITE_KEY'
      : 'RECAPTCHA_SITE_KEY';
    const siteKey = await db.getSetting(siteKeySetting);
    return new Response(buildVerifyPage(captchaType, siteKey, null, url.origin, webVerifyId), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return null;
}

/**
 * 检查并设置 Mini App 菜单按钮
 */
export async function ensureMiniAppMenu(kv, db) {
  const cacheKey = `miniapp_menu_set:${DEPLOY_VERSION}`;
  const already = await kv.get(cacheKey).catch(() => null);
  if (already) return;

  const botToken = await db.getSetting('BOT_TOKEN').catch(() => '');
  const webhookUrl = await db.getSetting('WEBHOOK_URL').catch(() => '');
  if (!botToken || !webhookUrl) return;

  const origin = new URL(webhookUrl).origin;
  const miniAppUrl = `${origin}/miniapp/`;
  await setupMiniAppMenu(new TG(botToken), miniAppUrl);
  await kv.put(cacheKey, '1', { expirationTtl: 864000 }).catch(() => {});
}

function buildVerifyPage(captchaType, siteKey, error, origin, webVerifyId) {
  const isTurnstile = captchaType === 'turnstile';
  const isRecaptcha = captchaType === 'recaptcha';
  const isRecaptchaV3 = captchaType === 'recaptcha_v3';
  const isHcaptcha = captchaType === 'hcaptcha';

  const scriptSrc = isTurnstile
    ? 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    : isRecaptcha
      ? 'https://www.google.com/recaptcha/api.js'
      : isRecaptchaV3
        ? 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(siteKey)
        : isHcaptcha
          ? 'https://js.hcaptcha.com/1/api.js'
          : '';

  const widgetHtml = isTurnstile
    ? '<div class="cf-turnstile" data-sitekey="' + escapeHtml(siteKey) + '" data-callback="onVerify"></div>'
    : isRecaptcha
      ? '<div class="g-recaptcha" data-sitekey="' + escapeHtml(siteKey) + '" data-callback="onVerify"></div>'
      : isRecaptchaV3
        ? '<div id="v3-status" class="desc">正在自动验证…</div>'
        : isHcaptcha
          ? '<div class="h-captcha" data-sitekey="' + escapeHtml(siteKey) + '" data-callback="onVerify"></div>'
          : '';

  const scriptTag = scriptSrc
    ? '<script src="' + scriptSrc + '" async defer><\/script>'
    : '';

  const expiredMsg = error === 'expired'
    ? '<div class="status expired">⏳ 验证链接已过期，请重新发送消息获取新链接。</div>'
    : '';

  const cardBody = expiredMsg
    ? expiredMsg
    : '<p class="desc">请完成下方验证以继续使用</p>'
      + '<div class="widget">' + widgetHtml + '</div>'
      + '<button id="submitBtn" class="btn btn-primary" disabled>验证中...</button>'
      + '<div id="status" class="status"></div>';

  const payloadKey = isTurnstile ? 'cf-turnstile-response'
    : isHcaptcha ? 'h-captcha-response'
    : 'g-recaptcha-response';

  let verifyScript = '';
  if (!error) {
    verifyScript = ''
      + '  var _token = "";\n'
      + '  window.onVerify = function(response) {\n'
      + '    _token = response;\n'
      + '    var btn = document.getElementById("submitBtn");\n'
      + '    if (btn) { btn.disabled = false; btn.textContent = "提交验证"; btn.onclick = submitVerify; }\n'
      + '  };\n'
      + '\n'
      + '  function submitVerify() {\n'
      + '    var btn = document.getElementById("submitBtn");\n'
      + '    var status = document.getElementById("status");\n'
      + '    if (btn) { btn.disabled = true; btn.innerHTML = \'<span class="spinner"></span>验证中...\'; }\n'
      + '    if (status) { status.style.display = "block"; status.className = "status"; status.textContent = "正在验证…"; }\n'
      + '    var payload = {"' + payloadKey + '": _token};\n'
      + '    fetch(window.location.href, {\n'
      + '      method: "POST",\n'
      + '      headers: { "Content-Type": "application/json" },\n'
      + '      body: JSON.stringify(payload),\n'
      + '    }).then(function(r) { return r.json(); }).then(function(data) {\n'
      + '      if (data.ok) {\n'
      + '        if (status) { status.className = "status success"; status.textContent = "✅ 验证成功！正在返回…"; }\n'
      + '        if (btn) btn.style.display = "none";\n'
      + '        if (tg) {\n'
      + '          tg.sendData(JSON.stringify({ type: "web_verify_ok", webVerifyId: webVerifyId }));\n'
      + '          setTimeout(function() { tg.close(); }, 300);\n'
      + '        }\n'
      + '      } else {\n'
      + '        if (status) { status.className = "status error"; status.textContent = "❌ 验证失败，请重试。"; }\n'
      + '        if (btn) { btn.disabled = false; btn.textContent = "重新验证"; }\n'
      + '        if (window.turnstile) turnstile.reset();\n'
      + '        if (window.grecaptcha) grecaptcha.reset();\n'
      + '        if (window.hcaptcha) hcaptcha.reset();\n'
      + '      }\n'
      + '    }).catch(function() {\n'
      + '      if (status) { status.className = "status error"; status.textContent = "❌ 网络错误，请重试。"; }\n'
      + '      if (btn) { btn.disabled = false; btn.textContent = "重新验证"; }\n'
      + '    });\n'
      + '  }\n'
      + '\n'
      + '  setTimeout(function() {\n'
      + '    var btn = document.getElementById("submitBtn");\n'
      + '    if (btn && !_token) btn.textContent = "请完成上方验证";\n'
      + '  }, 2000);\n';

    if (isRecaptchaV3) {
      verifyScript += ''
        + '  // reCAPTCHA v3: auto-execute with timeout fallback\n'
        + '  var v3Done = false;\n'
        + '  function v3Submit(token) {\n'
        + '    if (v3Done) return; v3Done = true;\n'
        + '    _token = token;\n'
        + '    submitVerify();\n'
        + '  }\n'
        + '  function v3Execute() {\n'
        + '    if (v3Done) return;\n'
        + '    if (!window.grecaptcha || typeof grecaptcha.ready !== "function") {\n'
        + '      setTimeout(v3Execute, 200);\n'
        + '      return;\n'
        + '    }\n'
        + '    grecaptcha.ready(function() {\n'
        + '      grecaptcha.execute("' + escapeHtml(siteKey) + '", { action: "verify" }).then(function(token) {\n'
        + '        v3Submit(token);\n'
        + '      }).catch(function() {\n'
        + '        var s = document.getElementById("v3-status");\n'
        + '        if (s) { s.textContent = "验证失败，点击重试"; s.style.cursor = "pointer"; s.onclick = v3Execute; }\n'
        + '      });\n'
        + '    });\n'
        + '  }\n'
        + '  v3Execute();\n'
        + '  setTimeout(function() {\n'
        + '    if (!v3Done) {\n'
        + '      var s = document.getElementById("v3-status");\n'
        + '      if (s) { s.textContent = "验证加载失败，点击重试"; s.style.cursor = "pointer"; s.onclick = v3Execute; }\n'
        + '    }\n'
        + '  }, 10000);\n';
    }
  }

  return '<!DOCTYPE html>\n'
    + '<html lang="zh">\n'
    + '<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n'
    + '<title>人机验证</title>\n'
    + '<style>\n'
    + '*{margin:0;padding:0;box-sizing:border-box}\n'
    + 'html,body{height:100%;overflow:hidden}\n'
    + 'body{min-height:100vh;display:flex;align-items:center;justify-content:center;\n'
    + '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;\n'
    + '  padding:20px}\n'
    + 'body.tg-bg{background:var(--tg-theme-bg-color,#f0f2f5)}\n'
    + 'body.tg-fg{color:var(--tg-theme-text-color,#1a1a2e)}\n'
    + '.card{background:var(--tg-theme-bg-color,#fff);border-radius:16px;\n'
    + '  box-shadow:0 8px 32px rgba(0,0,0,.1);\n'
    + '  padding:40px 32px;max-width:420px;width:100%;text-align:center}\n'
    + '.icon{font-size:48px;margin-bottom:16px}\n'
    + 'h1{font-size:20px;color:var(--tg-theme-text-color,#1a1a2e);margin-bottom:8px;font-weight:600}\n'
    + '.desc{font-size:14px;color:var(--tg-theme-hint-color,#666);margin-bottom:24px;line-height:1.5}\n'
    + '.widget{display:flex;justify-content:center;margin-bottom:20px;min-height:65px}\n'
    + '.status{padding:12px 16px;border-radius:8px;font-size:14px;margin-top:16px;display:none}\n'
    + '.status.success{display:block;background:#d4edda;color:#155724;border:1px solid #c3e6cb}\n'
    + '.status.error{display:block;background:#f8d7da;color:#721c24;border:1px solid #f5c6cb}\n'
    + '.status.expired{display:block;background:#fff3cd;color:#856404;border:1px solid #ffeaa7}\n'
    + '.spinner{display:inline-block;width:20px;height:20px;border:2px solid #fff;border-top-color:transparent;\n'
    + '  border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:8px}\n'
    + '@keyframes spin{to{transform:rotate(360deg)}}\n'
    + '.btn{display:inline-block;padding:12px 32px;border:none;border-radius:8px;font-size:15px;font-weight:500;\n'
    + '  cursor:pointer;transition:all .2s}\n'
    + '.btn-primary{background:var(--tg-theme-button-color,linear-gradient(135deg,#667eea,#764ba2));color:var(--tg-theme-button-text-color,#fff)}\n'
    + '.btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(102,126,234,.4)}\n'
    + '.btn-primary:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}\n'
    + '</style>\n'
    + '<script src="https://telegram.org/js/telegram-web-app.js"><\/script>\n'
    + scriptTag + '\n'
    + '</head>\n'
    + '<body>\n'
    + '<div class="card">\n'
    + '  <div class="icon">🔐</div>\n'
    + '  <h1>人机验证</h1>\n'
    + '  ' + cardBody + '\n'
    + '</div>\n'
    + '<script>\n'
    + '(function() {\n'
    + '  var tg = window.Telegram && window.Telegram.WebApp;\n'
    + '  if (tg) {\n'
    + '    tg.ready();\n'
    + '    tg.expand();\n'
    + '    document.body.classList.add("tg-bg", "tg-fg");\n'
    + '  }\n'
    + '\n'
    + '  var path = window.location.pathname;\n'
    + '  var webVerifyId = path.split("/").pop();\n'
    + '\n'
    + verifyScript
    + '})();\n'
    + '<\/script>\n'
    + '</body>\n'
    + '</html>';
}
