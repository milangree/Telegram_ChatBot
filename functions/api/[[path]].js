// functions/api/[[path]].js
import { DB } from '../_shared/db.js';
import { TG } from '../_shared/tg.js';
import { CORS, j, err, hashPw, verifyPw, createSession, getSession, delSession, extractToken, genToken } from '../_shared/auth.js';
import { verifyTOTP, generateTOTPSecret } from '../_shared/totp.js';
import { renderCaptchaPNG } from '../_shared/captcha.js';
import { setupCommands } from '../_shared/bot.js';
import { normalizeBotLocale } from '../_shared/bot-i18n.js';
import { exportBusinessDataSql, importBusinessDataSql } from '../_shared/db-sql.js';
import { createT, normalizeLocale } from '../../shared/i18n.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.KV) {
    const t = getApiTranslator(request);
    return err(t('kvNotBound'), 500);
  }

  const db = new DB(env.KV, env.D1 || null);
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
    return j({ active, hasD1 });
  }

  if (path === '/settings/db/switch' && request.method === 'POST') {
    try {
      const { target, sync } = await request.json();
      if (!['kv', 'd1'].includes(target)) return err(t('settings.invalidTarget'), 400);
      if (target === 'd1' && !env.D1) return err(t('settings.d1NotBound'), 400);

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
      const sql = await exportBusinessDataSql(db, active);
      const fileName = `${String(active || 'kv').toUpperCase()}.sql`;
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
      const { sql } = await request.json();
      if (!sql || !String(sql).trim()) return err(t('common.missingParams'), 400);

      const active = await db.getActiveDb();

      await db.clearAppDataPreserveWebUsers();
      await importBusinessDataSql({
        sqlText: String(sql),
        target: active,
        kvStore: db._kv,
        d1Store: db._d1,
      });

      if (db._d1) {
        const other = active === 'kv' ? 'd1' : 'kv';
        await db.syncData(active, other);
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
