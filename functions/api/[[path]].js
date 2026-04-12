// functions/api/[[path]].js
import { DB } from '../_shared/db.js';
import { TG } from '../_shared/tg.js';
import { CORS, j, err, hashPw, verifyPw, createSession, getSession, delSession, extractToken, genToken } from '../_shared/auth.js';
import { verifyTOTP, generateTOTPSecret } from '../_shared/totp.js';
import { renderCaptchaPNG } from '../_shared/captcha.js';
import { setupCommands } from '../_shared/bot.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.KV) return err('KV 未绑定', 500);

  const db   = new DB(env.KV, env.D1 || null);
  await db.ensureDefaultAdmin();
  const kv   = env.KV;
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  // ═══════════════════════════════════════════════
  // PUBLIC ROUTES
  // ═══════════════════════════════════════════════

  if (path === '/auth/status' && request.method === 'GET')
    return j({ needsRegistration: (await db.webUserCount()) === 0 });

  if (path === '/auth/register' && request.method === 'POST') {
    try {
      if ((await db.webUserCount()) > 0) return err('注册已关闭', 403);
      const { username, password } = await request.json();
      if (!username || !password)  return err('缺少参数');
      if (username.length < 3)     return err('用户名至少3字符');
      if (password.length < 6)     return err('密码至少6字符');
      if (await db.getWebUser(username)) return err('用户名已存在', 400);
      const user  = await db.createWebUser(username, await hashPw(password));
      // Disable the fallback admin/admins account so it can no longer log in
      await db.disableDefaultAdmin();
      const token = await createSession(kv, user.id);
      return new Response(JSON.stringify({ token, username: user.username, isAdmin: true }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token) },
      });
    } catch (e) { return err('注册失败: ' + e.message, 500); }
  }

  if (path === '/auth/login' && request.method === 'POST') {
    try {
      const { username, password, totp, loginMode } = await request.json();
      if (!username) return err('缺少用户名');

      const user = await db.getWebUser(username);
      if (!user) return err('用户名或密码错误', 401);

      // loginMode: 'totp_only' — login with just username + TOTP (no password)
      if (loginMode === 'totp_only') {
        if (!user.totp_enabled) return err('该账号未启用两步验证', 401);
        if (!totp) return err('缺少验证码', 401);
        if (!await verifyTOTP(totp, user.totp_secret)) return err('验证码错误', 401);
      } else {
        // Normal: username + password (+ TOTP if enabled)
        if (!password) return err('缺少密码');
        if (!await verifyPw(password, user.password_hash)) return err('用户名或密码错误', 401);
        if (user.totp_enabled) {
          if (!totp) return err('需要两步验证码', 401);
          if (!await verifyTOTP(totp, user.totp_secret)) return err('验证码错误', 401);
        }
      }

      const token = await createSession(kv, user.id);
      return new Response(JSON.stringify({ token, username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie(token) },
      });
    } catch (e) { return err('登录失败: ' + e.message, 500); }
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const token = extractToken(request);
    if (token) await delSession(kv, token);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': cookie('', 0) },
    });
  }

  if (path === '/auth/me' && request.method === 'GET') {
    const token = extractToken(request);
    if (!token) return err('未授权', 401);
    const sess = await getSession(kv, token);
    if (!sess) return err('会话已过期', 401);
    const user = await db.getWebUserById(sess.userId);
    if (!user) return err('用户不存在', 401);
    return j({ username: user.username, isAdmin: Boolean(user.is_admin), totpEnabled: Boolean(user.totp_enabled) });
  }

  // Check whether a username has 2FA (public, for login page to decide which mode to show)
  if (path === '/auth/totp-status' && request.method === 'POST') {
    try {
      const { username } = await request.json();
      const user = await db.getWebUser(username || '');
      return j({ totpEnabled: Boolean(user?.totp_enabled) });
    } catch { return j({ totpEnabled: false }); }
  }

  if (path === '/auth/recover' && request.method === 'POST') {
    try {
      const { username, totp, newPassword } = await request.json();
      if (!username || !totp || !newPassword) return err('缺少参数');
      const user = await db.getWebUser(username);
      if (!user || !user.totp_enabled) return err('该账号未启用两步验证', 400);
      if (!await verifyTOTP(totp, user.totp_secret)) return err('验证码错误', 401);
      if (newPassword.length < 6) return err('密码至少6字符');
      await db.updateWebUserPassword(user.id, await hashPw(newPassword));
      return j({ ok: true });
    } catch { return err('重置失败', 500); }
  }

  // Captcha image (public)
  const capMatch = path.match(/^\/captcha\/([a-f0-9]+)$/);
  if (capMatch && request.method === 'GET') {
    const text = await kv.get(`captcha_render:${capMatch[1]}`);
    if (!text) return new Response('Not Found', { status: 404 });
    const png = await renderCaptchaPNG(text, capMatch[1]);
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', ...CORS } });
  }

  // ═══════════════════════════════════════════════
  // AUTHENTICATED ROUTES
  // ═══════════════════════════════════════════════

  const token = extractToken(request);
  if (!token) return err('未授权', 401);
  const sess = await getSession(kv, token);
  if (!sess) return err('会话已过期', 401);
  const webUser = await db.getWebUserById(sess.userId);
  if (!webUser) return err('用户不存在', 401);

  // Profile
  if (path === '/profile/username' && request.method === 'PUT') {
    try {
      const { newUsername } = await request.json();
      if (!newUsername || newUsername.length < 3) return err('用户名至少3字符');
      if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) return err('用户名只能含字母数字下划线', 400);
      const ex = await db.getWebUser(newUsername);
      if (ex && ex.id !== webUser.id) return err('用户名已存在', 400);
      await db.updateWebUserUsername(webUser.id, newUsername);
      return j({ ok: true, username: newUsername });
    } catch { return err('修改失败', 500); }
  }

  if (path === '/profile/password' && request.method === 'PUT') {
    try {
      const { oldPassword, newPassword } = await request.json();
      if (!oldPassword || !newPassword) return err('缺少参数');
      if (!await verifyPw(oldPassword, webUser.password_hash)) return err('旧密码错误', 401);
      if (newPassword.length < 6) return err('密码至少6字符');
      await db.updateWebUserPassword(webUser.id, await hashPw(newPassword));
      return j({ ok: true });
    } catch { return err('修改失败', 500); }
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
    } catch { return err('操作失败', 500); }
  }

  if (path === '/profile/2fa/verify' && request.method === 'POST') {
    try {
      const { token: t, secret } = await request.json();
      if (!t || !secret) return err('缺少参数');
      if (!await verifyTOTP(t, secret)) return err('验证码无效', 400);
      await db.setWebUserTotp(webUser.id, secret, true);
      return j({ ok: true });
    } catch { return err('验证失败', 500); }
  }

  // Settings
  if (path === '/settings' && request.method === 'GET')
    return j(await db.getAllSettings());

  if (path === '/settings' && request.method === 'PUT') {
    try {
      const body    = await request.json();
      const allowed = [
        'BOT_TOKEN','FORUM_GROUP_ID','ADMIN_IDS',
        'VERIFICATION_ENABLED','VERIFICATION_TIMEOUT','MAX_VERIFICATION_ATTEMPTS',
        'AUTO_UNBLOCK_ENABLED','MAX_MESSAGES_PER_MINUTE',
        'CAPTCHA_TYPE','CAPTCHA_SITE_URL',
        'WELCOME_ENABLED','WELCOME_MESSAGE','BOT_COMMAND_FILTER','WHITELIST_ENABLED',
        'WEBHOOK_URL',
      ];
      for (const key of allowed) {
        if (body[key] !== undefined) await db.setSetting(key, String(body[key]));
      }
      return j({ ok: true });
    } catch { return err('保存失败', 500); }
  }

  if (path === '/settings/webhook' && request.method === 'POST') {
    try {
      const settings = await db.getAllSettings();
      if (!settings.BOT_TOKEN) return err('请先配置 Bot Token', 400);
      const { webhookUrl } = await request.json();
      if (!webhookUrl) return err('缺少 webhookUrl', 400);
      const tg = new TG(settings.BOT_TOKEN);
      let secret = settings.WEBHOOK_SECRET;
      if (!secret) { secret = genToken(32); await db.setSetting('WEBHOOK_SECRET', secret); }
      // Auto-set captcha site URL
      if (!settings.CAPTCHA_SITE_URL) await db.setSetting('CAPTCHA_SITE_URL', new URL(webhookUrl).origin);
      const res = await tg.setWebhook({ url: webhookUrl, secret });
      if (!res.ok) return err('设置失败: ' + res.description);
      // Persist webhook URL so the UI can display it
      await db.setSetting('WEBHOOK_URL', webhookUrl);
      // Setup bot commands
      await setupCommands(tg).catch(console.error);
      return j({ ok: true, message: 'Webhook 设置成功，命令已更新' });
    } catch { return err('设置失败', 500); }
  }

  if (path === '/settings/test-token' && request.method === 'POST') {
    try {
      const { token: t } = await request.json();
      if (!t) return err('缺少 token', 400);
      const res = await new TG(t).getMe();
      if (!res.ok) return err('Token 无效: ' + res.description);
      return j({ ok: true, bot: res.result });
    } catch { return err('测试失败', 500); }
  }

  // Database switch + sync
  if (path === '/settings/db' && request.method === 'GET') {
    const active = (await kv.get('config:active_db')) || 'kv';
    const hasD1  = !!env.D1;
    return j({ active, hasD1 });
  }

  if (path === '/settings/db/switch' && request.method === 'POST') {
    try {
      const { target, sync } = await request.json();
      if (!['kv', 'd1'].includes(target)) return err('无效目标', 400);
      if (target === 'd1' && !env.D1) return err('D1 未绑定', 400);
      const current = (await kv.get('config:active_db')) || 'kv';
      if (sync && current !== target) await db.syncData(current, target);
      await db.switchDb(target);
      return j({ ok: true, active: target });
    } catch (e) { return err('切换失败: ' + e.message, 500); }
  }

  // TG
  if (path === '/tg/resolve-chat' && request.method === 'POST') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err('Bot Token 未配置', 400);
      const { chatId } = await request.json();
      if (!chatId) return err('缺少 chatId', 400);
      const id  = typeof chatId === 'string' && /^-?\d+$/.test(chatId) ? parseInt(chatId, 10) : chatId;
      const res = await new TG(botToken).getChat(id);
      if (!res.ok) return err('无法获取: ' + res.description);
      return j({ ok: true, chat: res.result });
    } catch { return err('解析失败', 500); }
  }

  if (path === '/tg/me' && request.method === 'GET') {
    try {
      const t = await db.getSetting('BOT_TOKEN');
      if (!t) return err('Bot Token 未配置', 400);
      const res = await new TG(t).getMe();
      if (!res.ok) return err(res.description);
      return j({ ok: true, bot: res.result });
    } catch { return err('获取失败', 500); }
  }

  // Avatar proxy
  const avaMatch = path.match(/^\/users\/(\d+)\/avatar$/);
  if (avaMatch && request.method === 'GET') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return new Response('', { status: 404 });
      const tg   = new TG(botToken);
      const p    = await tg.getUserProfilePhotos({ userId: parseInt(avaMatch[1], 10), limit: 1 });
      if (!p.ok || p.result.total_count === 0) return new Response('', { status: 404 });
      const fRes = await tg.getFile({ fileId: p.result.photos[0][0].file_id });
      if (!fRes.ok) return new Response('', { status: 404 });
      const img  = await tg.fetchFile(fRes.result.file_path);
      return new Response(img.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', ...CORS } });
    } catch { return new Response('', { status: 404 }); }
  }

  // Users
  if (path === '/users/search' && request.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return j([]);
    return j(await db.searchUsers(q, 15));
  }

  if (path === '/users' && request.method === 'GET')
    return j(await db.getAllUsers(parseInt(url.searchParams.get('page') || '1', 10), 20));

  const blockMatch = path.match(/^\/users\/(\d+)\/(block|unblock)$/);
  if (blockMatch && request.method === 'PUT') {
    try {
      const uid = parseInt(blockMatch[1], 10), action = blockMatch[2];
      const body = await request.json();
      if (action === 'block') await db.blockUser(uid, body.reason || 'WebUI', webUser.id, body.permanent !== false);
      else await db.unblockUser(uid);
      return j({ ok: true });
    } catch { return err('操作失败', 500); }
  }

  const unameMatch = path.match(/^\/users\/(\d+)\/username$/);
  if (unameMatch && request.method === 'PUT') {
    try {
      const { username } = await request.json();
      await db.updateUsername(parseInt(unameMatch[1], 10), username);
      return j({ ok: true });
    } catch { return err('修改失败', 500); }
  }

  // Whitelist
  if (path === '/whitelist' && request.method === 'GET')
    return j(await db.getWhitelist(parseInt(url.searchParams.get('page') || '1', 10), 20));

  // Check whitelist status for a single user
  const wlCheckMatch = path.match(/^\/whitelist\/check\/(\d+)$/);
  if (wlCheckMatch && request.method === 'GET') {
    try {
      const uid = parseInt(wlCheckMatch[1], 10);
      const whitelisted = await db.isWhitelisted(uid);
      return j({ whitelisted });
    } catch { return err('查询失败', 500); }
  }

  const wlMatch = path.match(/^\/whitelist\/(\d+)$/);
  if (wlMatch && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      await db.addToWhitelist(parseInt(wlMatch[1], 10), body.reason || '', webUser.id);
      return j({ ok: true });
    } catch { return err('操作失败', 500); }
  }
  if (wlMatch && request.method === 'DELETE') {
    try { await db.removeFromWhitelist(parseInt(wlMatch[1], 10)); return j({ ok: true }); }
    catch { return err('操作失败', 500); }
  }

  // Conversations
  if (path === '/conversations' && request.method === 'GET')
    return j(await db.getRecentConvs(50));

  const convMatch = path.match(/^\/conversations\/(\d+)$/);
  if (convMatch && request.method === 'GET') {
    const uid  = parseInt(convMatch[1], 10);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const [user, messages] = await Promise.all([db.getUser(uid), db.getMsgs(uid, 50, (page - 1) * 50)]);
    return j({ user, messages });
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
        const settings  = await db.getAllSettings();
        const botToken  = settings.BOT_TOKEN;
        const groupId   = parseInt(settings.FORUM_GROUP_ID, 10);
        const user      = await db.getUser(uid);
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
    } catch (e) { return err('删除失败: ' + e.message, 500); }
  }

  if (path === '/stats' && request.method === 'GET')
    return j(await db.getStats());

  return err('接口不存在', 404);
}

function cookie(token, maxAge = 86400) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
