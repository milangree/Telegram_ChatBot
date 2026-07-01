// functions/api/[[path]].js
import { DB } from '../_shared/db.js';
import { TG } from '../_shared/tg.js';
import { CORS, j, err, hashPw, verifyPw, createSession, getSession, delSession, extractToken, genToken } from '../_shared/auth.js';
import { verifyTOTP, generateTOTPSecret } from '../_shared/totp.js';
import { renderCaptchaPNG } from '../_shared/captcha.js';
import { setupCommands, getOrCreateThread } from '../_shared/bot.js';
import { normalizeBotLocale, createBotT } from '../_shared/bot-i18n.js';
import { exportBusinessDataSql, importBusinessDataSql } from '../_shared/db-sql.js';
import { createT, normalizeLocale } from '../../shared/i18n.js';

export async function onRequest({ request, env, waitUntil }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.KV) {
    const t = getApiTranslator(request);
    return err(t('kvNotBound'), 500);
  }

  const db = new DB(env.KV, env.D1 || null, env.HYPERDRIVE || null);
  await db.autoRepair();
  await db.ensureDefaultAdmin();
  const kv = env.KV;
  const t = getApiTranslator(request, await db.getSetting('BOT_LOCALE'));
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  // ═══════════════════════════════════════════════
  // PUBLIC ROUTES
  // ═══════════════════════════════════════════════

  if (path === '/auth/status' && request.method === 'GET') {
    const hasDefaultAdmin = (await kv.get('auth:has_default_admin')) === '1';
    return j({ needsRegistration: hasDefaultAdmin || (await db.webUserCount()) === 0 });
  }

  if (path === '/auth/register' && request.method === 'POST') {
    try {
      const hasDefaultAdmin = (await kv.get('auth:has_default_admin')) === '1';
      if (!hasDefaultAdmin && (await db.webUserCount()) > 0) return err(t('auth.registrationClosed'), 403);
      const { username, password } = await request.json();
      if (!username || !password) return err(t('common.missingParams'));
      if (username.length < 3) return err(t('auth.usernameMin'));
      if (password.length < 6) return err(t('auth.passwordMin'));
      if (await db.getWebUser(username)) return err(t('auth.usernameExists'), 400);
      const user = await db.createWebUser(username, await hashPw(password));
      // Disable the fallback admin/admins account so it can no longer log in
      await db.disableDefaultAdmin();
      const sessionTtl = await getLoginSessionTtl(db);
      const token = await createSession(kv, user.id, sessionTtl);
      return new Response(JSON.stringify({ token, username: user.username, isAdmin: true }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl) },
      });
    } catch (e) {
      return err(t('auth.registerFailed', { error: e.message }), 500);
    }
  }

  if (path === '/auth/login' && request.method === 'POST') {
    try {
      const { username, password, totp, loginMode } = await request.json();
      if (!username) return err(t('auth.missingUsername'));

      const user = await db.getWebUser(username);
      if (!user) return err(t('auth.invalidCredentials'), 401);

      // If default admin fallback has been disabled, block admin/admins forever.
      if (String(user.username).toLowerCase() === 'admin') {
        const hasDefaultAdmin = (await kv.get('auth:has_default_admin')) === '1';
        if (!hasDefaultAdmin) return err(t('auth.invalidCredentials'), 401);
      }

      // loginMode: 'totp_only' — login with just username + TOTP (no password)
      if (loginMode === 'totp_only') {
        if (!user.totp_enabled) return err(t('auth.totpNotEnabled'), 401);
        if (!totp) return err(t('auth.missingTotp'), 401);
        if (!await verifyTOTP(totp, user.totp_secret)) return err(t('auth.invalidTotp'), 401);
      } else {
        // Normal: username + password only
        if (!password) return err(t('auth.missingPassword'));
        if (!await verifyPw(password, user.password_hash)) return err(t('auth.invalidCredentials'), 401);
      }

      const sessionTtl = await getLoginSessionTtl(db);
      const token = await createSession(kv, user.id, sessionTtl);
      return new Response(JSON.stringify({ token, username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token, sessionTtl) },
      });
    } catch (e) {
      return err(t('auth.loginFailed', { error: e.message }), 500);
    }
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const token = extractToken(request);
    if (token) await delSession(kv, token);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie('', 0) },
    });
  }

  if (path === '/auth/me' && request.method === 'GET') {
    const token = extractToken(request);
    if (!token) return err(t('auth.unauthorized'), 401);
    const sess = await getSession(kv, token);
    if (!sess) return err(t('auth.sessionExpired'), 401);
    const user = await db.getWebUserById(sess.userId);
    if (!user) return err(t('auth.userNotFound'), 401);
    return j({ username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) });
  }

  // Check whether a username has 2FA (public, for login page to decide which mode to show)
  if (path === '/auth/totp-status' && request.method === 'POST') {
    try {
      const { username } = await request.json();
      const user = await db.getWebUser(username || '');
      return j({ totpEnabled: Boolean(user?.totp_enabled) });
    } catch {
      return j({ totpEnabled: false });
    }
  }

  if (path === '/auth/recover' && request.method === 'POST') {
    try {
      const { username, totp, newPassword } = await request.json();
      if (!username || !totp || !newPassword) return err(t('common.missingParams'));
      const user = await db.getWebUser(username);
      if (!user || !user.totp_enabled) return err(t('auth.totpNotEnabled'), 400);
      if (!await verifyTOTP(totp, user.totp_secret)) return err(t('auth.invalidTotp'), 401);
      if (newPassword.length < 6) return err(t('auth.passwordMin'));
      await db.updateWebUserPassword(user.id, await hashPw(newPassword));
      return j({ ok: true });
    } catch {
      return err(t('auth.recoverFailed'), 500);
    }
  }

  // Captcha image (public)
  const capMatch = path.match(/^\/captcha\/([a-f0-9]+)$/);
  if (capMatch && request.method === 'GET') {
    const text = await kv.get(`captcha_render:${capMatch[1]}`);
    if (!text) return new Response(t('captcha.notFound'), { status: 404 });
    const png = await renderCaptchaPNG(text, capMatch[1]);
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', ...CORS } });
  }

  // Web verification page (public) — Turnstile / reCAPTCHA
  const webVerifyMatch = path.match(/^\/verify\/([a-f0-9]+)$/);
  if (webVerifyMatch) {
    const webVerifyId = webVerifyMatch[1];
    const webVerifyRaw = await kv.get(`webverify:${webVerifyId}`);

    // POST /api/verify/{token} — submit CAPTCHA response
    if (request.method === 'POST') {
      if (!webVerifyRaw) return j({ ok: false, error: 'expired' }, 404);
      const { userId, captchaType } = JSON.parse(webVerifyRaw);

      // Check if verification has expired
      const verifyRecord = await db.getVerify(userId).catch(() => null);
      if (!verifyRecord || verifyRecord.expires_at < Date.now()) {
        return j({ ok: false, error: 'expired' }, 410);
      }

      const body = await request.json().catch(() => ({}));
      const captchaResponse = body['cf-turnstile-response'] || body['g-recaptcha-response'] || '';
      if (!captchaResponse) return j({ ok: false, error: 'missing_captcha' }, 400);

      let verifyResult = false;
      if (captchaType === 'turnstile') {
        const secretKey = await db.getSetting('TURNSTILE_SECRET_KEY');
        if (!secretKey) return j({ ok: false, error: 'not_configured' }, 500);
        const formData = new URLSearchParams({ secret: secretKey, response: captchaResponse });
        const remoteIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
        if (remoteIp) formData.append('remoteip', remoteIp);
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
        const remoteIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
        if (remoteIp) formData.append('remoteip', remoteIp);
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

      // ── Mark verified and do all post-verification work in background ────
      await db.setUserVerified(userId, true);

      // Fire-and-forget: all Telegram API calls run in background
      const bgTask = (async () => {
        try {
          const botToken = await db.getSetting('BOT_TOKEN').catch(() => '');
          if (!botToken) return;
          const tg = new TG(botToken);
          const wvData = JSON.parse(webVerifyRaw);
          const verifyMsgId = wvData.verifyMsgId || verifyRecord?.verify_msg_id;

          // Clean up verify records
          await db.delVerify(userId).catch(() => {});
          await kv.delete(`webverify:${webVerifyId}`).catch(() => {});

          // Delete verification message
          if (verifyMsgId) {
            const del = await tg.deleteMsg({ chatId: userId, msgId: verifyMsgId }).catch(() => null);
            if (!del?.ok) {
              const ed = await tg.editText({ chatId: userId, msgId: verifyMsgId, text: '✅ 验证已完成', kb: [] }).catch(() => null);
              if (!ed?.ok) await tg.editCaption({ chatId: userId, msgId: verifyMsgId, caption: '✅ 验证已完成', kb: [] }).catch(() => {});
            }
          }

          // Send success notification
          const locale = normalizeBotLocale(await db.getSetting('BOT_LOCALE').catch(() => 'zh-hans'));
          const botT = createBotT(locale);
          await tg.sendMsg({ chatId: userId, text: botT('verify.success') }).catch(() => {});

          // Forward pending message
          const pendingRaw = await kv.get(`pending:${userId}`).catch(() => null);
          if (pendingRaw) {
            await kv.delete(`pending:${userId}`).catch(() => {});
            try {
              const p = JSON.parse(pendingRaw);
              const groupId = parseInt(await db.getSetting('FORUM_GROUP_ID').catch(() => '0'), 10);
              if (groupId && p.msgId) {
                const fakeUser = { id: userId, first_name: '' };
                const tid = await getOrCreateThread(tg, db, fakeUser, groupId, kv, botT);
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

    // GET /api/verify/{token} — serve verification HTML page
    if (request.method === 'GET') {
      if (!webVerifyRaw) {
        return new Response(buildVerifyPage(null, null, 'expired', url.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      const { userId: wvUserId, captchaType } = JSON.parse(webVerifyRaw);
      // Check if verification has expired
      const verifyRecord = await db.getVerify(wvUserId).catch(() => null);
      if (!verifyRecord || verifyRecord.expires_at < Date.now()) {
        return new Response(buildVerifyPage(null, null, 'expired', url.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      const siteKeySetting = captchaType === 'turnstile' ? 'TURNSTILE_SITE_KEY'
        : captchaType === 'recaptcha_v3' ? 'RECAPTCHA_V3_SITE_KEY'
        : 'RECAPTCHA_SITE_KEY';
      const siteKey = await db.getSetting(siteKeySetting);
      return new Response(buildVerifyPage(captchaType, siteKey, null, url.origin), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  }

  // ═══════════════════════════════════════════════
  // AUTHENTICATED ROUTES
  // ═══════════════════════════════════════════════

  const token = extractToken(request);
  if (!token) return err(t('auth.unauthorized'), 401);
  const sess = await getSession(kv, token);
  if (!sess) return err(t('auth.sessionExpired'), 401);
  const webUser = await db.getWebUserById(sess.userId);
  if (!webUser) return err(t('auth.userNotFound'), 401);

  // Profile
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
      if (newPassword.length < 6) return err(t('auth.passwordMin'));
      await db.updateWebUserPassword(webUser.id, await hashPw(newPassword));
      return j({ ok: true });
    } catch {
      return err(t('profile.updateFailed'), 500);
    }
  }

  if (path === '/profile/2fa/setup' && request.method === 'POST') {
    try {
      const { enable } = await request.json();
      if (enable) {
        const secret = generateTOTPSecret();
        await db.setWebUserTotp(webUser.id, secret, false);
        return j({ secret, qrcode: `otpauth://totp/BotAdmin:${webUser.username}?secret=${secret}&issuer=BotAdmin` });
      }
      await db.setWebUserTotp(webUser.id, null, false);
      return j({ ok: true });
    } catch {
      return err(t('profile.operationFailed'), 500);
    }
  }

  if (path === '/profile/2fa/verify' && request.method === 'POST') {
    try {
      const { token: totpToken, secret } = await request.json();
      if (!totpToken || !secret) return err(t('common.missingParams'));
      if (!await verifyTOTP(totpToken, secret)) return err(t('profile.invalidTotp'), 400);
      await db.setWebUserTotp(webUser.id, secret, true);
      return j({ ok: true });
    } catch {
      return err(t('profile.verifyFailed'), 500);
    }
  }

  // Settings
  if (path === '/settings' && request.method === 'GET') return j(await db.getAllSettings());

  if (path === '/settings' && request.method === 'PUT') {
    try {
      const body = await request.json();
      const previousSettings = await db.getAllSettings();
      const previousBotToken = String(previousSettings.BOT_TOKEN || '');
      const allowed = [
        'BOT_TOKEN', 'FORUM_GROUP_ID', 'ADMIN_IDS',
        'VERIFICATION_ENABLED', 'VERIFICATION_TIMEOUT', 'MAX_VERIFICATION_ATTEMPTS',
        'AUTO_UNBLOCK_ENABLED', 'MAX_MESSAGES_PER_MINUTE',
        'INLINE_KB_MSG_DELETE_ENABLED', 'INLINE_KB_MSG_DELETE_SECONDS',
        'CAPTCHA_TYPE', 'CAPTCHA_SITE_URL',
        'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
        'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY',
        'RECAPTCHA_V3_SITE_KEY', 'RECAPTCHA_V3_SECRET_KEY', 'RECAPTCHA_V3_SCORE_THRESHOLD',
        'WELCOME_ENABLED', 'WELCOME_MESSAGE', 'BOT_COMMAND_FILTER', 'WHITELIST_ENABLED',
        'ADMIN_NOTIFY_ENABLED',
        'LOGIN_SESSION_TTL',
        'BOT_LOCALE',
        'ZALGO_FILTER_ENABLED',
        'MESSAGE_FILTER_RULES',
        'WEBHOOK_URL',
      ];

      let shouldRefreshCommands = false;
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        const value = key === 'BOT_LOCALE'
          ? normalizeBotLocale(body[key])
          : String(body[key]);
        await db.setSetting(key, value);
        if (key === 'BOT_TOKEN' || key === 'BOT_LOCALE') shouldRefreshCommands = true;
      }

      const nextBotToken = body.BOT_TOKEN === undefined ? previousBotToken : String(body.BOT_TOKEN || '');
      if (body.BOT_TOKEN !== undefined && previousBotToken && previousBotToken !== nextBotToken) {
        try {
          await new TG(previousBotToken).deleteWebhook({ dropPendingUpdates: false });
        } catch (e) {
          console.error('delete old webhook after bot token change failed:', e);
        }
      }

      if (shouldRefreshCommands) {
        try {
          const latest = await db.getAllSettings();
          if (latest.BOT_TOKEN) {
            await setupCommands(new TG(latest.BOT_TOKEN), latest.BOT_LOCALE);
          }
        } catch (e) {
          console.error('refresh commands after settings save failed:', e);
        }
      }

      return j({ ok: true });
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
      // Auto-set captcha site URL
      if (!settings.CAPTCHA_SITE_URL) await db.setSetting('CAPTCHA_SITE_URL', new URL(webhookUrl).origin);
      const res = await tg.setWebhook({ url: webhookUrl, secret });
      if (!res.ok) return err(t('settings.setupFailed', { error: res.description }));
      // Persist webhook URL so the UI can display it
      await db.setSetting('WEBHOOK_URL', webhookUrl);
      // Setup bot commands
      await setupCommands(tg, settings.BOT_LOCALE).catch(console.error);
      return j({ ok: true, message: t('settings.webhookSetupSuccess') });
    } catch (e) {
      return err(t('settings.setupFailed', { error: e?.message || '' }), 500);
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

  // Database switch + sync
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
      return err(t('settings.switchFailed', { error: e.message }), 500);
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
      return err(t('settings.clearDataFailed', { error: e.message }), 500);
    }
  }

  if (path === '/settings/sql/export' && request.method === 'POST') {
    try {
      const active = await db.getActiveDb();
      const body = await request.json().catch(() => ({}));
      const mode = String(body?.mode || 'base64').toLowerCase();
      const password = String(body?.password || '');
      if (!['plain', 'base64', 'aes'].includes(mode)) return err(t('common.missingParams'), 400);
      if (mode === 'aes' && !password) return err(t('common.missingParams'), 400);

      const sql = await exportBusinessDataSql(db, active, { mode, password });
      const modeSuffix = mode === 'plain' ? 'PLAIN' : (mode === 'aes' ? 'AES' : 'BASE64');
      const fileName = `${String(active || 'kv').toUpperCase()}_${modeSuffix}.sql`;
      return new Response(sql, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'no-store',
          'X-Active-Db': active,
        },
      });
    } catch (e) {
      return err(t('settings.sqlExportFailed', { error: e.message }), 500);
    }
  }

  if (path === '/settings/sql/import' && request.method === 'POST') {
    try {
      const { sql, password } = await request.json();
      if (!sql || !String(sql).trim()) return err(t('common.missingParams'), 400);

      const active = await db.getActiveDb();

      await db.clearAppDataPreserveWebUsers();
      await importBusinessDataSql({
        sqlText: String(sql),
        target: active,
        kvStore: db._kv,
        d1Store: db._d1,
        hyperdriveStore: db._hyperdrive,
        password: String(password || ''),
      });

      if (db._d1 && active !== 'd1') {
        const other = active === 'kv' ? 'd1' : 'kv';
        await db.syncData(active, other);
      }
      if (db._hyperdrive && active !== 'hyperdrive') {
        await db.syncData(active, 'hyperdrive');
      }

      return j({ ok: true, active });
    } catch (e) {
      return err(t('settings.sqlImportFailed', { error: e.message }), 500);
    }
  }

  // TG
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

  // Avatar proxy
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

  // Users
  if (path === '/users/search' && request.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return j([]);
    return j(await db.searchUsers(q, 15));
  }

  if (path === '/users' && request.method === 'GET') {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = clampPageSize(url.searchParams.get('pageSize'));
    const filter = String(url.searchParams.get('filter') || '').trim();

    if (filter === 'blocked') return j(await db.getBlockedUsers(page, pageSize));
    if (filter === 'normal') return j(await db.getNormalUsers(page, pageSize));
    return j(await db.getAllUsers(page, pageSize));
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

  // Whitelist
  if (path === '/whitelist' && request.method === 'GET') {
    return j(await db.getWhitelist(parseInt(url.searchParams.get('page') || '1', 10), 20));
  }

  // Check whitelist status for a single user
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

  // Conversations
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

  // Delete a conversation: wipe messages, recent entry, reset verification, optionally close TG topic
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
          // Delete topic — this removes all messages inside it
          await tg.deleteForumTopic({ chatId: groupId, threadId: user.thread_id })
            .catch(() => tg.closeForumTopic({ chatId: groupId, threadId: user.thread_id }));
          // Clear stored thread_id so a new topic is created next message
          await db.clearUserThread(uid);
        }
      }

      return j({ ok: true, reVerifyRequired: !(await db.isWhitelisted(uid)) });
    } catch (e) {
      return err(t('conversations.deleteFailed', { error: e.message }), 500);
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

function cookie(token, maxAge = 86400) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function buildVerifyPage(captchaType, siteKey, error, origin) {
  const isTurnstile = captchaType === 'turnstile';
  const isRecaptcha = captchaType === 'recaptcha';
  const isRecaptchaV3 = captchaType === 'recaptcha_v3';

  const scriptSrc = isTurnstile
    ? 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    : isRecaptcha
      ? 'https://www.google.com/recaptcha/api.js'
      : isRecaptchaV3
        ? 'https://www.google.com/recaptcha/api.js?render=' + siteKey
        : '';

  const widgetHtml = isTurnstile
    ? '<div class="cf-turnstile" data-sitekey="' + siteKey + '" data-callback="onVerify"></div>'
    : isRecaptcha
      ? '<div class="g-recaptcha" data-sitekey="' + siteKey + '" data-callback="onVerify"></div>'
      : isRecaptchaV3
        ? '<div id="v3-status" class="desc">正在自动验证…</div>'
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

  const payloadKey = isTurnstile ? 'cf-turnstile-response' : 'g-recaptcha-response';

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
        + '      grecaptcha.execute("' + siteKey + '", { action: "verify" }).then(function(token) {\n'
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
