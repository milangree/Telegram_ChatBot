// functions/api/[[path]].js
import { DB } from '../_shared/db.js';
import { TG } from '../_shared/tg.js';
import {
  CORS, j, err, hashPw, verifyPw, createSession, getSession, delSession,
  delSessionsForUser, bumpSessionEpoch,
  rotatePasswordAndRevokeSessions, extractToken, genToken, verifyInitData,
  getClientIp, checkAuthRateLimit, recordAuthFailure, clearAuthFailures,
  validatePassword, validatePasswordReason, isLegacyPasswordHash, fuzzRetryTime,
} from '../_shared/auth.js';
import { ensureAdminInitializedOnce, getBootstrapStatus, isBootstrapAdminDisabled, registerInitialAdmin, adoptBootstrapAdmin, BootstrapError } from '../_shared/admin-bootstrap.js';
import { verifyTOTP, generateTOTPSecret } from '../_shared/totp.js';
import { renderCaptchaPNG } from '../_shared/captcha.js';
import { setupMiniAppMenu, getOrCreateThread } from '../_shared/bot.js';
import { normalizeBotLocale, createBotT } from '../_shared/bot-i18n.js';
import { exportBusinessDataSql, importBusinessDataSql, parseBusinessSql } from '../_shared/db-sql.js';
import { createT, normalizeLocale } from '../../shared/i18n.js';

/** 返回给前端时需要脱敏的密钥字段 */
const SECRET_SETTING_KEYS = [
  'BOT_TOKEN',
  'WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'RECAPTCHA_SECRET_KEY',
  'RECAPTCHA_V3_SECRET_KEY',
  'HCAPTCHA_SECRET_KEY',
];

function maskSecretValue(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 4) return '****';
  return `****${s.slice(-4)}`;
}

function isMaskedOrEmptySecret(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  if (!s) return true;
  // 前端回传的脱敏值（**** / ****xxxx）视为「未修改」
  return s.startsWith('****');
}

function maskSettingsForClient(settings) {
  const out = { ...(settings || {}) };
  for (const key of SECRET_SETTING_KEYS) {
    if (key in out) out[key] = maskSecretValue(out[key]);
  }
  return out;
}

function isWebAdmin(user) {
  return Boolean(user && (user.is_admin === 1 || user.is_admin === true || user.is_admin === '1'));
}

/** 为用户列表附加 is_whitelisted，避免前端 N+1 */
async function attachWhitelistFlags(db, payload) {
  if (!payload || !Array.isArray(payload.users)) return payload;
  const users = await Promise.all(payload.users.map(async (u) => {
    if (!u) return u;
    if (u.is_blocked) return { ...u, is_whitelisted: false };
    try {
      const whitelisted = await db.isWhitelisted(u.user_id);
      return { ...u, is_whitelisted: !!whitelisted };
    } catch {
      return { ...u, is_whitelisted: false };
    }
  }));
  return { ...payload, users };
}

export async function onRequest({ request, env, waitUntil }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.KV) {
    const t = getApiTranslator(request);
    return err(t('kvNotBound'), 500);
  }

  const db = new DB(env.KV, env.D1 || null, env.HYPERDRIVE || null);
  const kv = env.KV;
  let t = getApiTranslator(request);
  try {
    await db.autoRepair();
    await ensureAdminInitializedOnce({ db, kv, env });
  } catch (e) {
    console.error('[API] 管理员初始化失败:', e?.message || e);
    if (e instanceof BootstrapError) return err(t('unavailable'), e.status || 503);
    return err(t('unavailable'), 503);
  }
  t = getApiTranslator(request, await db.getSetting('BOT_LOCALE'));
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  // 无需等待用户操作，Webhook URL 已配置时自动设置 Mini App 菜单按钮
  // 如果设置过程中出错（未配置 BOT_TOKEN 等），静默跳过，不阻塞后续请求
  if (path !== '/settings/webhook' && path !== '/settings') {
    ensureMiniAppMenu(kv, db).catch(() => {});
  }

  // ═══════════════════════════════════════════════
  // 公开路由（无需认证）
  // ═══════════════════════════════════════════════

  if (path === '/auth/status' && request.method === 'GET') {
    const status = await getBootstrapStatus({ db, kv }).catch(() => ({ state: 'error', needsRegistration: false }));
    return j({ needsRegistration: status.needsRegistration });
  }

  if (path === '/auth/register' && request.method === 'POST') {
    try {
      const status = await getBootstrapStatus({ db, kv })
      if (!status.needsRegistration) return err(t('auth.registrationClosed'), 403)
      const { username, password } = await request.json();
      if (typeof username !== 'string' || typeof password !== 'string') return err(t('common.missingParams'));
      if (!username || !password) return err(t('common.missingParams'));
      if (username.length < 3) return err(t('auth.usernameMin'));
      if (!validatePassword(password)) return err(t('auth.passwordMin'));

      // pending 阶段允许公开首次注册（无需先登录初始管理员）。
      // 若当前会话恰好是初始管理员，则传入 bootstrapUserId 做额外一致性校验。
      let bootstrapUserId = null
      const bootstrapTokenValue = extractToken(request)
      if (bootstrapTokenValue) {
        const bootstrapSession = await getSession(kv, bootstrapTokenValue)
        if (bootstrapSession) {
          const bootstrapUser = await db.getWebUserById(bootstrapSession.userId)
          if (bootstrapUser && !(await isBootstrapAdminDisabled({ kv, user: bootstrapUser }))) {
            bootstrapUserId = bootstrapUser.id
          }
        }
      }

      const user = await registerInitialAdmin({
        db, kv, username, password, bootstrapUserId,
      })
      const sessionTtl = await getLoginSessionTtl(db);
      const token = await createSession(kv, user.id, sessionTtl);
      return new Response(JSON.stringify({ username: user.username, isAdmin: true }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl, { secure: isSecureRequest(request) }) },
      });
    } catch (e) {
      console.error('[API Error] auth.registerFailed:', e?.message || e);
      const status = e instanceof BootstrapError ? e.status || 500 : 500;
      // BootstrapError 消息已是可读文案，优先返回；否则用通用失败文案
      if (e instanceof BootstrapError && e.message) return err(e.message, status);
      return err(t('auth.registerFailed'), status);
    }
  }

  if (path === '/auth/login' && request.method === 'POST') {
    // 读取 body 仅一次，避免 "Body has already been read"
    const parsedBody = await request.json().catch(() => ({}));
    // 检测 Telegram Web App 登录（带 initData）
    if (parsedBody.initData && !parsedBody.username) {
      return handleTelegramLogin(parsedBody.initData, db, kv, t, request);
    }

    try {
      const { username, password, totp } = parsedBody;
      // 严格类型校验，防止 NoSQL 操作符注入（如 {"$gt":""}）等对象/数组绕过
      if (typeof username !== 'string' || typeof password !== 'string') {
        const ip = getClientIp(request);
        await recordAuthFailure(kv, 'login', { ip, username }).catch(() => {});
        return err(t('auth.invalidCredentials'), 401);
      }
      const ip = getClientIp(request);
      const rateId = { ip, username };

      // 拒绝已废弃的 totp_only：2FA 不得作为唯一因子
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

      // 若初始管理员已被禁用，阻止该账号登录（按 ID，不限于用户名 admin）
      if (await isBootstrapAdminDisabled({ kv, user })) {
        await recordAuthFailure(kv, 'login', rateId);
        return err(t('auth.invalidCredentials'), 401);
      }

      // 始终要求密码；若已启用 2FA 必须同时校验 TOTP
      if (!password) return err(t('auth.missingPassword'));
      if (!await verifyPw(password, user.password_hash)) {
        await recordAuthFailure(kv, 'login', rateId);
        return err(t('auth.invalidCredentials'), 401);
      }
      if (user.totp_enabled) {
        if (!totp) {
          // 密码正确但缺第二因子：提示前端补充 TOTP（不记失败，避免误伤）
          return err(t('auth.totpRequired'), 401);
        }
        if (!await verifyTOTP(totp, user.totp_secret)) {
          await recordAuthFailure(kv, 'login', rateId);
          return err(t('auth.invalidTotp'), 401);
        }
      }

      // 登录成功：清除失败计数；旧版 sha256 哈希静默升级为 PBKDF2
      await clearAuthFailures(kv, 'login', rateId);
      if (isLegacyPasswordHash(user.password_hash)) {
        try {
          await db.updateWebUserPassword(user.id, await hashPw(password));
        } catch (e) {
          console.error('[API] legacy password rehash failed:', e?.message || e);
        }
      }

      // 初始管理员在 pending 阶段登录：视为采用该账号，关闭首次注册，直接进入后台
      try {
        const status = await getBootstrapStatus({ db, kv })
        if (status?.needsRegistration && status?.defaultAdminId === user.id) {
          await adoptBootstrapAdmin({ db, kv, userId: user.id })
        }
      } catch (e) {
        console.error('[API] adopt bootstrap on login failed:', e?.message || e)
      }

      const sessionTtl = await getLoginSessionTtl(db);
      const token = await createSession(kv, user.id, sessionTtl);
      // 不在 JSON 体回传 session token，仅依赖 HttpOnly Cookie
      return new Response(JSON.stringify({ username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl, { secure: isSecureRequest(request) }) },
      });
    } catch (e) {
      console.error('[API Error] auth.loginFailed:', e.message);
      return err(t('auth.loginFailed'), 500);
    }
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
      // 未启用 2FA 的账号禁止在线自助重置（改用运维 CLI）；不区分「无用户 / 未开 2FA」
      if (!user || !user.totp_enabled || await isBootstrapAdminDisabled({ kv, user })) {
        await recordAuthFailure(kv, 'recover', rateId);
        return err(t('auth.invalidCredentials'), 401);
      }

      if (!await verifyTOTP(totp, user.totp_secret)) {
        await recordAuthFailure(kv, 'recover', rateId);
        return err(t('auth.invalidTotp'), 401);
      }

      await rotatePasswordAndRevokeSessions({ db, kv, userId: user.id, newPassword });
      await clearAuthFailures(kv, 'recover', rateId);
      return j({ ok: true });
    } catch {
      return err(t('auth.recoverFailed'), 500);
    }
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
    const webVerifyId = webVerifyMatch[1];
    const webVerifyRaw = await kv.get(`webverify:${webVerifyId}`);

    // POST /api/verify/{token} — 提交 CAPTCHA 响应
    if (request.method === 'POST') {
      if (!webVerifyRaw) return j({ ok: false, error: 'expired' }, 404);
      const { userId, captchaType } = JSON.parse(webVerifyRaw);

      // 检查验证是否已过期
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
        if (!captchaResponse) return j({ ok: false, error: 'missing_captcha' }, 400);
        const formData = new URLSearchParams({ secret: secretKey, response: captchaResponse });
        try {
          const resp = await fetch('https://api.hcaptcha.com/siteverify', { method: 'POST', body: formData });
          const result = await resp.json();
          verifyResult = result.success === true;
        } catch { verifyResult = false; }
      } else if (captchaType === 'turnstile') {
        if (!captchaResponse) return j({ ok: false, error: 'missing_captcha' }, 400);
        const secretKey = await db.getSetting('TURNSTILE_SECRET_KEY');
        if (!secretKey) return j({ ok: false, error: 'not_configured' }, 500);
        const formData = new URLSearchParams({ secret: secretKey, response: captchaResponse });
        try {
          const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: formData });
          const result = await resp.json();
          verifyResult = result.success === true;
        } catch { verifyResult = false; }
      } else if (captchaType === 'recaptcha' || captchaType === 'recaptcha_v3') {
        if (!captchaResponse) return j({ ok: false, error: 'missing_captcha' }, 400);
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

      // ── 标记已验证，后台立即执行所有 Telegram 操作 ────────────────────
      await db.setUserVerified(userId, true);

      // 后台异步执行：删除消息、发送通知、转发消息，不阻塞响应
      const bgTask = (async () => {
        try {
          const botToken = await db.getSetting('BOT_TOKEN').catch(() => '');
          if (!botToken) return;
          const tg = new TG(botToken);
          const wvData = JSON.parse(webVerifyRaw);
          const verifyMsgId = wvData.verifyMsgId || verifyRecord?.verify_msg_id;

          // 清理验证记录
          await db.delVerify(userId).catch(() => {});
          await kv.delete(`webverify:${webVerifyId}`).catch(() => {});

          // 删除验证消息
          if (verifyMsgId) {
            const del = await tg.deleteMsg({ chatId: userId, msgId: verifyMsgId }).catch(() => null);
            if (!del?.ok) {
              const ed = await tg.editText({ chatId: userId, msgId: verifyMsgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
              if (!ed?.ok) await tg.editCaption({ chatId: userId, msgId: verifyMsgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
            }
          }

          // 发送成功通知
          const locale = normalizeBotLocale(await db.getSetting('BOT_LOCALE').catch(() => 'zh-hans'));
          const botT = createBotT(locale);
          await tg.sendMsg({ chatId: userId, text: botT('verify.success') }).catch(() => {});

          // 转发待处理消息
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
      // 检查验证是否已过期
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
  }

  // ═══════════════════════════════════════════════
  // 认证路由（需要登录）
  // ═══════════════════════════════════════════════

  const token = extractToken(request);
  if (!token) return err(t('auth.unauthorized'), 401);
  const sess = await getSession(kv, token);
  if (!sess) return err(t('auth.sessionExpired'), 401);
  const webUser = await db.getWebUserById(sess.userId);
  if (!webUser) return err(t('auth.userNotFound'), 401);
  if (await isBootstrapAdminDisabled({ kv, user: webUser })) return err(t('auth.unauthorized'), 401);
  const adminUser = isWebAdmin(webUser);

  // 管理类接口需要 is_admin（个人资料除外）
  const isProfilePath = path.startsWith('/profile/');
  if (!isProfilePath && !adminUser) {
    return err(t('auth.forbidden') || t('auth.unauthorized'), 403);
  }

  // 个人资料
  if (path === '/profile/username' && request.method === 'PUT') {
    try {
      const { newUsername } = await request.json();
      if (!newUsername || newUsername.length < 3) return err(t('auth.usernameMin'));
      if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) return err(t('profile.usernamePattern'), 400);
      const ex = await db.getWebUser(newUsername);
      if (ex && ex.id !== webUser.id) return err(t('auth.usernameExists'), 400);
      await db.updateWebUserUsername(webUser.id, newUsername);
      return j({ ok: true, username: newUsername });
    } catch {
      return err(t('profile.updateFailed'), 500);
    }
  }

  if (path === '/profile/password' && request.method === 'PUT') {
    try {
      const { oldPassword, newPassword } = await request.json();
      if (!oldPassword || !newPassword) return err(t('common.missingParams'));
      if (!await verifyPw(oldPassword, webUser.password_hash)) return err(t('profile.oldPasswordWrong'), 401);
      if (!validatePassword(newPassword)) return err(t('auth.passwordMin'));
      await rotatePasswordAndRevokeSessions({ db, kv, userId: webUser.id, newPassword });
      return j({ ok: true, reLogin: true });
    } catch {
      return err(t('profile.updateFailed'), 500);
    }
  }

  if (path === '/profile/2fa/setup' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const enable = body?.enable;
      if (enable) {
        // 已启用则拒绝重新 setup，避免覆盖种子
        if (webUser.totp_enabled) return err(t('profile.operationFailed'), 400);
        const secret = generateTOTPSecret();
        await db.setWebUserTotp(webUser.id, secret, false);
        return j({ secret, qrcode: `otpauth://totp/BotAdmin:${webUser.username}?secret=${secret}&issuer=BotAdmin` });
      }

      // 关闭 2FA：必须校验当前密码 + 当前 TOTP，防止会话被盗后永久降级
      if (!webUser.totp_enabled) {
        await db.setWebUserTotp(webUser.id, null, false);
        return j({ ok: true });
      }
      const { password, totp: totpCode } = body || {};
      if (!password || !totpCode) return err(t('common.missingParams'));
      if (!await verifyPw(password, webUser.password_hash)) return err(t('profile.oldPasswordWrong'), 401);
      if (!await verifyTOTP(totpCode, webUser.totp_secret)) return err(t('profile.invalidTotp'), 400);

      await db.setWebUserTotp(webUser.id, null, false);
      // 吊销其他会话，迫使用新安全水位重新登录
      await bumpSessionEpoch(kv, webUser.id);
      await delSessionsForUser(kv, webUser.id);
      // 保留当前请求会话：重新签发
      const sessionTtl = await getLoginSessionTtl(db);
      const newToken = await createSession(kv, webUser.id, sessionTtl);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Set-Cookie': cookie(newToken, sessionTtl, { secure: isSecureRequest(request) }),
        },
      });
    } catch {
      return err(t('profile.operationFailed'), 500);
    }
  }

  if (path === '/profile/2fa/verify' && request.method === 'POST') {
    try {
      const { token: totpToken } = await request.json();
      if (!totpToken) return err(t('common.missingParams'));
      // 只信任服务端 pending secret（setup 写入且 enabled=false），拒绝客户端 secret
      const pendingSecret = webUser.totp_secret;
      if (!pendingSecret || webUser.totp_enabled) return err(t('profile.operationFailed'), 400);
      if (!await verifyTOTP(totpToken, pendingSecret)) return err(t('profile.invalidTotp'), 400);
      await db.setWebUserTotp(webUser.id, pendingSecret, true);
      return j({ ok: true });
    } catch {
      return err(t('profile.verifyFailed'), 500);
    }
  }

  // 设置（GET 脱敏；PUT 忽略脱敏/空密钥字段，视为未修改）
  if (path === '/settings' && request.method === 'GET') {
    return j(maskSettingsForClient(await db.getAllSettings()));
  }

  if (path === '/settings' && request.method === 'PUT') {
    try {
      const body = await request.json();
      const previousSettings = await db.getAllSettings();
      const previousBotToken = String(previousSettings.BOT_TOKEN || '');
      const allowed = [
        'BOT_TOKEN', 'FORUM_GROUP_ID', 'ADMIN_IDS',
        'VERIFICATION_ENABLED', 'VERIFICATION_TIMEOUT', 'MAX_VERIFICATION_ATTEMPTS',
        'AUTO_UNBLOCK_ENABLED',
        'INLINE_KB_MSG_DELETE_ENABLED', 'INLINE_KB_MSG_DELETE_SECONDS',
        'USER_MSG_DELETE_SECONDS',
        'CAPTCHA_TYPE', 'CAPTCHA_SITE_URL',
        'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
        'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY',
        'RECAPTCHA_V3_SITE_KEY', 'RECAPTCHA_V3_SECRET_KEY', 'RECAPTCHA_V3_SCORE_THRESHOLD',
        'HCAPTCHA_SITE_KEY', 'HCAPTCHA_SECRET_KEY',
        'WELCOME_ENABLED', 'WELCOME_MESSAGE', 'BOT_COMMAND_FILTER', 'WHITELIST_ENABLED',
        'ADMIN_NOTIFY_ENABLED',
        'LOGIN_SESSION_TTL',
        'BOT_LOCALE',
        'ZALGO_FILTER_ENABLED',
        'MESSAGE_FILTER_RULES',
        'WEBHOOK_URL',
      ];

      let shouldRefreshCommands = false;
      let botTokenChanged = false;
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        // 密钥字段：脱敏值或空串 = 保持原值
        if (SECRET_SETTING_KEYS.includes(key) && isMaskedOrEmptySecret(body[key])) continue;

        const value = key === 'BOT_LOCALE'
          ? normalizeBotLocale(body[key])
          : String(body[key]);
        await db.setSetting(key, value);
        if (key === 'BOT_TOKEN' || key === 'BOT_LOCALE') shouldRefreshCommands = true;
        if (key === 'BOT_TOKEN') botTokenChanged = true;
      }

      const nextBotToken = botTokenChanged
        ? String(body.BOT_TOKEN || '')
        : previousBotToken;
      if (botTokenChanged && previousBotToken && previousBotToken !== nextBotToken) {
        try {
          const webhookResult = await new TG(previousBotToken).deleteWebhook({ dropPendingUpdates: false });
          if (!webhookResult?.ok) {
            console.error('delete old webhook after bot token change failed:', webhookResult);
          }
        } catch (e) {
          console.error('delete old webhook after bot token change failed:', e);
        }
      }

      if (shouldRefreshCommands) {
        try {
          const latest = await db.getAllSettings();
          if (latest.BOT_TOKEN) {
            // 从 WEBHOOK_URL 提取 origin，拼接 Mini App URL
            if (latest.WEBHOOK_URL) {
              const origin = new URL(latest.WEBHOOK_URL).origin;
              await setupMiniAppMenu(new TG(latest.BOT_TOKEN), `${origin}/miniapp/`);
            }
          }
        } catch (e) {
          console.error('refresh commands after settings save failed:', e);
        }
      }

      // 返回脱敏后的最新设置，方便前端同步展示
      return j({ ok: true, settings: maskSettingsForClient(await db.getAllSettings()) });
    } catch {
      return err(t('settings.saveFailed'), 500);
    }
  }

  if (path === '/settings/webhook' && request.method === 'POST') {
    try {
      const settings = await db.getAllSettings();
      if (!settings.BOT_TOKEN) return err(t('settings.botTokenRequired'), 400);
      const { webhookUrl } = await request.json();
      if (!webhookUrl) return err(t('settings.missingWebhookUrl'), 400);
      const tg = new TG(settings.BOT_TOKEN);
      let secret = settings.WEBHOOK_SECRET;
      if (!secret) {
        secret = genToken(32);
        await db.setSetting('WEBHOOK_SECRET', secret);
      }
      // 自动设置验证码站点 URL
      if (!settings.CAPTCHA_SITE_URL) await db.setSetting('CAPTCHA_SITE_URL', new URL(webhookUrl).origin);
      const res = await tg.setWebhook({ url: webhookUrl, secret });
      if (!res.ok) return err(t('settings.setupFailed', { error: res.description }));
      // 持久化 Webhook URL 供前端展示
      await db.setSetting('WEBHOOK_URL', webhookUrl);
      // 从 WEBHOOK_URL 提取 origin，拼接 Mini App URL 并设置菜单按钮
      const miniAppUrl = `${new URL(webhookUrl).origin}/miniapp/`;
      await setupMiniAppMenu(tg, miniAppUrl).catch(console.error);
      return j({ ok: true, message: t('settings.webhookSetupSuccess') });
    } catch (e) {
      console.error('[API Error] settings.setupFailed:', e?.message || '');
      return err(t('settings.setupFailed'), 500);
    }
  }

  if (path === '/settings/test-token' && request.method === 'POST') {
    try {
      const { token: testToken } = await request.json();
      if (!testToken) return err(t('settings.missingToken'), 400);
      const res = await new TG(testToken).getMe();
      if (!res.ok) return err(t('settings.invalidToken', { error: res.description }));
      return j({ ok: true, bot: res.result });
    } catch {
      return err(t('settings.testFailed'), 500);
    }
  }

  // 数据库切换 + 同步
  if (path === '/settings/db' && request.method === 'GET') {
    const active = await db.getActiveDb();
    const hasD1 = !!env.D1;
    const hasHyperdrive = !!env.HYPERDRIVE;
    return j({ active, hasD1, hasHyperdrive });
  }

  if (path === '/settings/db/switch' && request.method === 'POST') {
    try {
      const { target, sync } = await request.json();
      if (!['kv', 'd1', 'hyperdrive'].includes(target)) return err(t('settings.invalidTarget'), 400);
      if (target === 'd1' && !env.D1) return err(t('settings.d1NotBound'), 400);
      if (target === 'hyperdrive' && !env.HYPERDRIVE) return err(t('settings.hyperdriveNotBound'), 400);

      const current = await db.getActiveDb();
      if (sync && current !== target) await db.syncData(current, target);

      await db.switchDb(target);
      return j({ ok: true, active: target });
    } catch (e) {
      console.error('[API Error] settings.switchFailed:', e.message);
      return err(t('settings.switchFailed'), 500);
    }
  }

  if (path === '/settings/clear-data' && request.method === 'POST') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (botToken) {
        try {
          await new TG(botToken).deleteWebhook({ dropPendingUpdates: true });
        } catch (e) {
          console.error('delete webhook before clearing data failed:', e);
        }
      }

      await db.clearAppDataPreserveWebUsers();
      return j({ ok: true });
    } catch (e) {
      console.error('[API Error] settings.clearDataFailed:', e.message);
      return err(t('settings.clearDataFailed'), 500);
    }
  }

  if (path === '/settings/sql/export' && request.method === 'POST') {
    try {
      const active = await db.getActiveDb();
      const body = await request.json().catch(() => ({}));
      // 仅支持 AES 二进制包（打开即乱码）；password 必填
      // 默认打包全部数据：密钥 + Web 登录账号
      const password = String(body?.password || '');
      if (!password) return err(t('common.missingParams'), 400);
      const includeSecrets = body?.includeSecrets === false || body?.includeSecrets === 0 || body?.includeSecrets === '0'
        ? false
        : true;
      const includeWebUsers = body?.includeWebUsers === false || body?.includeWebUsers === 0 || body?.includeWebUsers === '0'
        ? false
        : true;

      const binary = await exportBusinessDataSql(db, active, {
        password,
        includeSecrets,
        includeWebUsers,
        secretKeys: SECRET_SETTING_KEYS,
      });
      const fileName = `${String(active || 'kv').toUpperCase()}_AES.db`;
      return new Response(binary, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'no-store',
          'X-Active-Db': active,
          'X-Export-Secrets': includeSecrets ? '1' : '0',
          'X-Export-WebUsers': includeWebUsers ? '1' : '0',
          'X-Export-Format': 'tgcb-bin-aes',
        },
      });
    } catch (e) {
      console.error('[API Error] settings.sqlExportFailed:', e.message);
      return err(t('settings.sqlExportFailed'), 500);
    }
  }

  if (path === '/settings/sql/import' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      // 支持：AES 二进制 .db（base64）/ 旧版文本 AES·Base64 / 旧版明文 .sql
      const password = String(body?.password || '');
      const sqlPayload = body?.sql ?? body?.data ?? '';
      if (!sqlPayload || !String(sqlPayload).trim()) return err(t('common.missingParams'), 400);

      // 明文旧 .sql 可不填密码；加密包必须带密码
      const looksPlainLegacy = typeof sqlPayload === 'string'
        && (sqlPayload.includes('TGCB_RECORD') || sqlPayload.includes('-- TGCB_RECORD'))
        && !sqlPayload.startsWith('-- TGCB_SQL_AES')
        && !sqlPayload.startsWith('-- TGCB_SQL_BASE64');
      if (!password && !looksPlainLegacy) return err(t('common.missingParams'), 400);

      const active = await db.getActiveDb();
      const importPassword = password;
      const snapshotStore = await db._store();

      // 若备份含 web_users，导入时一并替换 Web 账号；否则保留现有 Web 账号
      const parsedPreview = await parseBusinessSql(sqlPayload, { password: importPassword });
      const hasWebUsers = Array.isArray(parsedPreview.web_users) && parsedPreview.web_users.length > 0;

      await importBusinessDataSql({
        sqlText: sqlPayload,
        target: active,
        kvStore: db._kv,
        d1Store: db._d1,
        hyperdriveStore: db._hyperdrive,
        password: importPassword,
        clearFn: () => hasWebUsers
          ? db.clearAppDataIncludingWebUsers()
          : db.clearAppDataPreserveWebUsers(),
        snapshotStore,
      });

      if (db._d1 && active !== 'd1') {
        const other = active === 'kv' ? 'd1' : 'kv';
        await db.syncData(active, other);
      }
      if (db._hyperdrive && active !== 'hyperdrive') {
        await db.syncData(active, 'hyperdrive');
      }

      return j({ ok: true, active, restoredWebUsers: hasWebUsers });
    } catch (e) {
      console.error('[API Error] settings.sqlImportFailed:', e.message);
      return err(t('settings.sqlImportFailed'), 500);
    }
  }

  // Telegram API
  if (path === '/tg/resolve-chat' && request.method === 'POST') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err(t('tg.botTokenNotConfigured'), 400);
      const { chatId } = await request.json();
      if (!chatId) return err(t('tg.missingChatId'), 400);
      const id = typeof chatId === 'string' && /^-?\d+$/.test(chatId) ? parseInt(chatId, 10) : chatId;
      const res = await new TG(botToken).getChat(id);
      if (!res.ok) return err(t('tg.fetchFailed', { error: res.description }));
      return j({ ok: true, chat: res.result });
    } catch {
      return err(t('tg.resolveFailed'), 500);
    }
  }

  if (path === '/tg/me' && request.method === 'GET') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err(t('tg.botTokenNotConfigured'), 400);
      const res = await new TG(botToken).getMe();
      if (!res.ok) return err(t('tg.fetchFailed', { error: res.description }));
      return j({ ok: true, bot: res.result });
    } catch {
      return err(t('tg.getFailed'), 500);
    }
  }

  // 头像代理
  const avaMatch = path.match(/^\/users\/(\d+)\/avatar$/);
  if (avaMatch && request.method === 'GET') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return new Response('', { status: 404 });
      const tg = new TG(botToken);
      const p = await tg.getUserProfilePhotos({ userId: parseInt(avaMatch[1], 10), limit: 1 });
      if (!p.ok || p.result.total_count === 0) return new Response('', { status: 404 });
      const fRes = await tg.getFile({ fileId: p.result.photos[0][0].file_id });
      if (!fRes.ok) return new Response('', { status: 404 });
      const img = await tg.fetchFile(fRes.result.file_path);
      return new Response(img.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', ...CORS } });
    } catch {
      return new Response('', { status: 404 });
    }
  }

  // 消息媒体代理（photo / sticker / animation 等，按 file_id 拉取）
  if (path === '/tg/file' && request.method === 'GET') {
    try {
      const fileId = String(url.searchParams.get('file_id') || url.searchParams.get('id') || '').trim();
      if (!fileId) return new Response('', { status: 400 });
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return new Response('', { status: 404 });
      const tg = new TG(botToken);
      const fRes = await tg.getFile({ fileId });
      if (!fRes?.ok || !fRes.result?.file_path) return new Response('', { status: 404 });
      const filePath = fRes.result.file_path;
      const img = await tg.fetchFile(filePath);
      if (!img?.ok) return new Response('', { status: 404 });
      const lower = String(filePath).toLowerCase();
      const ctype = lower.endsWith('.webp') ? 'image/webp'
        : lower.endsWith('.png') ? 'image/png'
        : lower.endsWith('.gif') ? 'image/gif'
        : lower.endsWith('.tgs') ? 'application/x-tgsticker'
        : lower.endsWith('.webm') ? 'video/webm'
        : lower.endsWith('.mp4') ? 'video/mp4'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg'
        : (img.headers?.get?.('content-type') || 'application/octet-stream');
      return new Response(img.body, {
        headers: {
          'Content-Type': ctype,
          'Cache-Control': 'private, max-age=3600',
          ...CORS,
        },
      });
    } catch {
      return new Response('', { status: 404 });
    }
  }

  // 用户管理
  if (path === '/users/search' && request.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return j([]);
    return j(await db.searchUsers(q, 15));
  }

  if (path === '/users' && request.method === 'GET') {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = clampPageSize(url.searchParams.get('pageSize'));
    const filter = String(url.searchParams.get('filter') || '').trim();

    let payload;
    if (filter === 'blocked') payload = await db.getBlockedUsers(page, pageSize);
    else if (filter === 'normal') payload = await db.getNormalUsers(page, pageSize);
    else payload = await db.getAllUsers(page, pageSize);
    return j(await attachWhitelistFlags(db, payload));
  }

  const blockMatch = path.match(/^\/users\/(\d+)\/(block|unblock)$/);
  if (blockMatch && request.method === 'PUT') {
    try {
      const uid = parseInt(blockMatch[1], 10);
      const action = blockMatch[2];
      const body = await request.json();
      if (action === 'block') {
        const settings = await db.getAllSettings();
        const adminIds = parseAdminIds(settings.ADMIN_IDS);
        if (adminIds.includes(uid)) return err(t('users.cannotBanAdmin'), 400);
        await db.blockUser(uid, body.reason || t('users.reason.webUi'), webUser.id, body.permanent === true);
      } else {
        await db.unblockUser(uid);
      }
      return j({ ok: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }

  const delUserMatch = path.match(/^\/users\/(\d+)$/);
  if (delUserMatch && request.method === 'DELETE') {
    try {
      const uid = parseInt(delUserMatch[1], 10);
      const deleted = await db.deleteUser(uid);
      if (!deleted) return err(t('users.notFound'), 404);
      return j({ ok: true, reVerifyRequired: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }

  const unameMatch = path.match(/^\/users\/(\d+)\/username$/);
  if (unameMatch && request.method === 'PUT') return err(t('users.usernameFeatureRemoved'), 410);

  // 白名单
  if (path === '/whitelist' && request.method === 'GET') {
    return j(await db.getWhitelist(parseInt(url.searchParams.get('page') || '1', 10), 20));
  }

  // 检查单个用户的白名单状态
  const wlCheckMatch = path.match(/^\/whitelist\/check\/(\d+)$/);
  if (wlCheckMatch && request.method === 'GET') {
    try {
      const uid = parseInt(wlCheckMatch[1], 10);
      const whitelisted = await db.isWhitelisted(uid);
      return j({ whitelisted });
    } catch {
      return err(t('whitelist.queryFailed'), 500);
    }
  }

  const wlMatch = path.match(/^\/whitelist\/(\d+)$/);
  if (wlMatch && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      await db.addToWhitelist(parseInt(wlMatch[1], 10), body.reason || '', webUser.id);
      return j({ ok: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }
  if (wlMatch && request.method === 'DELETE') {
    try {
      await db.removeFromWhitelist(parseInt(wlMatch[1], 10));
      return j({ ok: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }

  // 对话记录
  if (path === '/conversations' && request.method === 'GET') {
    const since = String(url.searchParams.get('since') || '').trim();
    const items = since ? await db.getRecentConvsSince(since, 50) : await db.getRecentConvs(50);
    return j({
      items,
      mode: since ? 'delta' : 'full',
      serverTime: new Date().toISOString(),
    });
  }

  const convMatch = path.match(/^\/conversations\/(\d+)$/);
  if (convMatch && request.method === 'GET') {
    const uid = parseInt(convMatch[1], 10);
    const since = String(url.searchParams.get('since') || '').trim();
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const [user, messages] = await Promise.all([
      db.getUser(uid),
      since ? db.getMsgsSince(uid, since, 50) : db.getMsgs(uid, 50, (page - 1) * 50),
    ]);
    return j({
      user,
      messages,
      mode: since ? 'delta' : 'full',
      serverTime: new Date().toISOString(),
    });
  }

  // 删除对话：清除消息、最近记录、重置验证，可选关闭 TG 话题
  if (convMatch && request.method === 'DELETE') {
    try {
      const uid = parseInt(convMatch[1], 10);
      const body = await request.json().catch(() => ({}));

      // 1. Delete all messages from storage
      await db.deleteUserMsgs(uid);

      // 2. Reset verification status so user must verify again (unless whitelisted)
      const isWl = await db.isWhitelisted(uid);
      if (!isWl) await db.setUserVerified(uid, false);

      // 3. Optionally close (delete) the Telegram forum topic
      if (body.closeTopic !== false) {
        const settings = await db.getAllSettings();
        const botToken = settings.BOT_TOKEN;
        const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
        const user = await db.getUser(uid);
        if (botToken && groupId && user?.thread_id) {
          const tg = new TG(botToken);
          // 删除话题 — 会移除话题内所有消息
          await tg.deleteForumTopic({ chatId: groupId, threadId: user.thread_id })
            .catch(() => tg.closeForumTopic({ chatId: groupId, threadId: user.thread_id }));
          // 清除存储的 thread_id，下次发消息时自动创建新话题
          await db.clearUserThread(uid);
        }
      }

      return j({ ok: true, reVerifyRequired: !(await db.isWhitelisted(uid)) });
    } catch (e) {
      console.error('[API Error] conversations.deleteFailed:', e.message);
      return err(t('conversations.deleteFailed'), 500);
    }
  }

  // 网页端向用户发送消息（文本 / 图片 / 文件）
  if (convMatch && request.method === 'POST') {
    try {
      const uid = parseInt(convMatch[1], 10);
      if (!Number.isFinite(uid) || uid <= 0) return err(t('common.missingParams'));

      const contentType = String(request.headers.get('content-type') || '').toLowerCase();
      let kind = 'text';
      let text = '';
      let caption = '';
      let fileName = '';
      let mimeType = '';
      let fileBytes = null;

      if (contentType.includes('multipart/form-data')) {
        const form = await request.formData();
        kind = String(form.get('kind') || form.get('type') || 'document').toLowerCase();
        text = String(form.get('text') || form.get('message') || '').trim();
        caption = String(form.get('caption') || text || '').trim();
        const file = form.get('file');
        if (file && typeof file.arrayBuffer === 'function') {
          fileName = String(file.name || form.get('filename') || 'file.bin');
          mimeType = String(file.type || form.get('mime') || 'application/octet-stream');
          fileBytes = new Uint8Array(await file.arrayBuffer());
          if (!kind || kind === 'file') {
            kind = mimeType.startsWith('image/') ? 'photo' : 'document';
          }
        } else if (text) {
          kind = 'text';
        } else {
          return err(t('common.missingParams'));
        }
      } else {
        const body = await request.json().catch(() => ({}));
        kind = String(body?.kind || body?.type || 'text').toLowerCase();
        text = String(body?.text || body?.message || '').trim();
        caption = String(body?.caption || text || '').trim();
        if (kind !== 'text') {
          // JSON 内嵌 base64 文件
          const b64 = String(body?.fileBase64 || body?.data || '').replace(/^data:[^;]+;base64,/, '');
          if (!b64) return err(t('common.missingParams'));
          fileName = String(body?.filename || body?.fileName || 'file.bin');
          mimeType = String(body?.mime || body?.mimeType || 'application/octet-stream');
          const bin = atob(b64);
          fileBytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) fileBytes[i] = bin.charCodeAt(i);
          if (kind === 'file') kind = mimeType.startsWith('image/') ? 'photo' : 'document';
        } else if (!text) {
          return err(t('common.missingParams'));
        }
      }

      if (fileBytes && fileBytes.byteLength > 20 * 1024 * 1024) {
        return err(t('conversations.fileTooLarge') || '文件过大（上限 20MB）', 400);
      }

      const settings = await db.getAllSettings();
      const botToken = settings.BOT_TOKEN;
      if (!botToken) return err(t('settings.botTokenRequired') || t('common.missingParams'), 400);
      const tg = new TG(botToken);

      let sendResult = null;
      let messageType = 'text';
      let storedContent = text;

      if (kind === 'text') {
        sendResult = await tg.sendMsg({ chatId: uid, text });
        messageType = 'text';
        storedContent = text;
      } else {
        const blob = new Blob([fileBytes], { type: mimeType || 'application/octet-stream' });
        const mediaKind = kind === 'photo' ? 'photo' : 'document';
        sendResult = await tg.sendMediaUpload({
          kind: mediaKind,
          chatId: uid,
          blob,
          filename: fileName || (mediaKind === 'photo' ? 'photo.jpg' : 'file.bin'),
          caption: caption || undefined,
        });
        messageType = mediaKind;
        storedContent = caption || fileName || (mediaKind === 'photo' ? '[photo]' : '[document]');
      }

      if (!sendResult?.ok) {
        console.error('[API] send to user failed:', sendResult?.description || sendResult);
        return err(t('conversations.sendFailed') || '发送失败', 502);
      }

      const tgMsgId = sendResult?.result?.message_id;
      let fileIdStored = '';
      if (kind !== 'text' && sendResult?.result) {
        const r = sendResult.result;
        if (Array.isArray(r.photo) && r.photo.length) {
          fileIdStored = r.photo[r.photo.length - 1]?.file_id || '';
        } else if (r.document?.file_id) {
          fileIdStored = r.document.file_id;
        } else if (r.sticker?.file_id) {
          fileIdStored = r.sticker.file_id;
        } else if (r.animation?.file_id) {
          fileIdStored = r.animation.file_id;
        } else if (r.video?.file_id) {
          fileIdStored = r.video.file_id;
        }
      }
      if (fileIdStored) {
        storedContent = caption ? `${fileIdStored}\n${caption}` : fileIdStored;
      }

      await db.addMsg({
        userId: uid,
        direction: 'outgoing',
        content: storedContent,
        messageType,
        telegramMessageId: tgMsgId,
      });

      return j({
        ok: true,
        message: {
          id: `${Date.now()}_web`,
          user_id: uid,
          direction: 'outgoing',
          content: storedContent,
          message_type: messageType,
          telegram_message_id: tgMsgId,
          created_at: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.error('[API Error] conversations.sendFailed:', e?.message || e);
      return err(t('conversations.sendFailed') || '发送失败', 500);
    }
  }

  if (path === '/stats' && request.method === 'GET') {
    return j(await db.getStats());
  }

  return err(t('notFound'), 404);
}

function getApiTranslator(request, fallbackLocale = 'zh-hans') {
  const preferred = request.headers.get('X-Locale') || request.headers.get('Accept-Language') || fallbackLocale;
  const normalized = normalizeLocale(String(preferred).split(',')[0].trim());
  const base = createT(normalized);
  return (key, params = {}) => base(`api.${key}`, params);
}

async function getLoginSessionTtl(db) {
  const raw = await db.getSetting('LOGIN_SESSION_TTL');
  return Math.max(300, parseInt(raw || '86400', 10) || 86400);
}

function clampPageSize(value, fallback = 20, max = 200) {
  const parsed = parseInt(value || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseAdminIds(str) {
  return (str || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
}

function cookie(token, maxAge = 86400, { secure = false } = {}) {
  // Secure 仅在明确要求或 HTTPS 部署时附加（Workers 无 process.env 时由调用方传入）
  const securePart = secure ? '; Secure' : '';
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${securePart}`;
}

function isSecureRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.protocol === 'https:') return true;
  } catch { /* noop */ }
  // Cloudflare / 反向代理常见头
  const proto = request.headers.get('x-forwarded-proto') || request.headers.get('cf-visitor') || '';
  if (String(proto).toLowerCase().includes('https')) return true;
  // 仅在显式配置 COOKIE_SECURE=1 时附加 Secure（Docker 经 HTTPS 反向代理时手动开启）
  // 注意：不要用 NODE_ENV=production 推断 —— Docker 直连 HTTP 时这会让 Cookie 带上 Secure，
  // 浏览器在 HTTP 下不会回传 Secure Cookie，导致 /api/auth/me 持续 401 死循环。
  try {
    if (typeof process !== 'undefined' && process?.env && process.env.COOKIE_SECURE === '1') {
      return true;
    }
  } catch { /* noop */ }
  return false;
}

/**
 * 处理 Telegram Web App 免密登录。
 * 验签 initData → 校验 ADMIN_IDS → 影子 web_user → Cookie 会话。
 */
async function handleTelegramLogin(initData, db, kv, t, request) {
  try {
    // IP 级别速率限制，防止 initData 接口被滥用
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

    // 影子 web_user 账户（按用户名 tg_<id> 查找或创建）
    const shadowUser = `tg_${tgId}`;
    let webUser = await db.getWebUser(shadowUser);
    if (!webUser) {
      const hash = await hashPw(genToken(32));
      // Mini App 登录仅 ADMIN_IDS 白名单用户可达，影子账号为管理员
      webUser = await db.createWebUser(shadowUser, hash, { isAdmin: true });
    }

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

/**
 * 检查是否已设置 Mini App 菜单按钮，未设置且 WEBHOOK_URL 已填写时自动设置。
 * 在每次非写设置接口的请求中触发（fire-and-forget）。
 * 通过 KV 键 miniapp_menu_set 标记已设置，避免重复调用 Telegram Bot API。
 */
async function ensureMiniAppMenu(kv, db) {
  const already = await kv.get('miniapp_menu_set').catch(() => null);
  if (already) return;

  const botToken = await db.getSetting('BOT_TOKEN').catch(() => '');
  const webhookUrl = await db.getSetting('WEBHOOK_URL').catch(() => '');
  if (!botToken || !webhookUrl) return;

  const origin = new URL(webhookUrl).origin;
  const miniAppUrl = `${origin}/miniapp/`;
  await setupMiniAppMenu(new TG(botToken), miniAppUrl);
  // 标记已设置（10 天后自动过期，可以重新尝试）
  await kv.put('miniapp_menu_set', '1', { expirationTtl: 864000 }).catch(() => {});
}

/**
 * 简单的 HTML 转义，防止 siteKey 等动态内容中的 XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
        + '  // Fallback: if reCAPTCHA fails to load within 10s, show error\n'
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
