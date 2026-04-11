// functions/api/[[path]].js
import { DB } from '../_shared/db.js';
import { TG } from '../_shared/tg.js';
import {
  CORS, j, err,
  hashPw, verifyPw,
  createSession, getSession, delSession,
  extractToken, genToken,
} from '../_shared/auth.js';
import { verifyTOTP, generateTOTPSecret } from '../_shared/totp.js';

export async function onRequest({ request, env }) {
  // ── CORS preflight ──
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!env.KV) return err('KV 命名空间未绑定', 500);

  const db  = new DB(env.KV);
  await db.ensureDefaultAdmin();
  const kv  = env.KV;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  // ══════════════════════════════════════════════════════════
  // PUBLIC ROUTES (no auth required)
  // ══════════════════════════════════════════════════════════

  if (path === '/auth/status' && request.method === 'GET') {
    try {
      const count = await db.webUserCount();
      return j({ needsRegistration: count === 0 });
    } catch {
      return err('获取状态失败', 500);
    }
  }

  if (path === '/auth/register' && request.method === 'POST') {
    try {
      const count = await db.webUserCount();
      if (count > 0) return err('注册已关闭', 403);

      const { username, password } = await request.json();
      if (!username || !password) return err('用户名和密码不能为空');
      if (username.length < 3)    return err('用户名至少3个字符');
      if (password.length < 6)    return err('密码至少6个字符');

      if (await db.getWebUser(username)) return err('用户名已存在', 400);

      const user  = await db.createWebUser(username, await hashPw(password));
      const token = await createSession(kv, user.id);
      return new Response(
        JSON.stringify({ token, username: user.username, isAdmin: true }),
        {
          status: 200,
          headers: {
            ...CORS,
            'Content-Type': 'application/json',
            'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
          },
        },
      );
    } catch (e) {
      return err('注册失败: ' + e.message, 500);
    }
  }

  if (path === '/auth/login' && request.method === 'POST') {
    try {
      const { username, password, totp } = await request.json();
      if (!username || !password) return err('用户名和密码不能为空');

      const user  = await db.getWebUser(username);
      if (!user)                              return err('用户名或密码错误', 401);
      if (!await verifyPw(password, user.password_hash)) return err('用户名或密码错误', 401);

      if (user.totp_enabled) {
        if (!totp) return err('需要两步验证码', 401);
        if (!await verifyTOTP(totp, user.totp_secret)) return err('验证码错误', 401);
      }

      const token = await createSession(kv, user.id);
      return new Response(
        JSON.stringify({ token, username: user.username, isAdmin: Boolean(user.is_admin) }),
        {
          status: 200,
          headers: {
            ...CORS,
            'Content-Type': 'application/json',
            'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
          },
        },
      );
    } catch (e) {
      return err('登录失败: ' + e.message, 500);
    }
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const token = extractToken(request);
    if (token) await delSession(kv, token);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    });
  }

  if (path === '/auth/me' && request.method === 'GET') {
    const token = extractToken(request);
    if (!token) return err('未授权', 401);
    const sess = await getSession(kv, token);
    if (!sess)  return err('会话已过期', 401);
    const user  = await db.getWebUserById(sess.userId);
    if (!user)  return err('用户不存在', 401);
    return j({ username: user.username, isAdmin: Boolean(user.is_admin) });
  }

  /**
   * FIX: /auth/recover was placed AFTER the auth guard, meaning a logged-out
   * user could never use it (the exact scenario it exists for). Moved here
   * into the public section.
   */
  if (path === '/auth/recover' && request.method === 'POST') {
    try {
      const { username, totp, newPassword } = await request.json();
      if (!username || !totp || !newPassword) return err('缺少参数');
      const user = await db.getWebUser(username);
      if (!user || !user.totp_enabled)        return err('该用户未启用两步验证', 400);
      if (!await verifyTOTP(totp, user.totp_secret)) return err('验证码错误', 401);
      if (newPassword.length < 6)             return err('新密码至少6个字符');
      await db.updateWebUserPassword(user.id, await hashPw(newPassword));
      return j({ ok: true });
    } catch (e) {
      return err('重置密码失败', 500);
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUTHENTICATED ROUTES
  // ══════════════════════════════════════════════════════════

  const token = extractToken(request);
  if (!token) return err('未授权', 401);

  const sess = await getSession(kv, token);
  if (!sess)  return err('会话已过期', 401);

  const webUser = await db.getWebUserById(sess.userId);
  if (!webUser) return err('用户不存在', 401);

  // ── Profile: change username ──
  if (path === '/profile/username' && request.method === 'PUT') {
    try {
      const { newUsername } = await request.json();
      if (!newUsername)                             return err('新用户名不能为空', 400);
      if (newUsername.length < 3)                   return err('用户名至少3个字符');
      if (!/^[a-zA-Z0-9_]+$/.test(newUsername))    return err('用户名只能包含字母、数字和下划线', 400);
      const existing = await db.getWebUser(newUsername);
      if (existing && existing.id !== webUser.id)  return err('用户名已存在', 400);
      await db.updateWebUserUsername(webUser.id, newUsername);
      return j({ ok: true, username: newUsername });
    } catch {
      return err('修改用户名失败', 500);
    }
  }

  // ── Profile: change password ──
  if (path === '/profile/password' && request.method === 'PUT') {
    try {
      const { oldPassword, newPassword } = await request.json();
      if (!oldPassword || !newPassword)                    return err('缺少参数');
      if (!await verifyPw(oldPassword, webUser.password_hash)) return err('旧密码错误', 401);
      if (newPassword.length < 6)                          return err('新密码至少6个字符');
      await db.updateWebUserPassword(webUser.id, await hashPw(newPassword));
      return j({ ok: true });
    } catch {
      return err('修改密码失败', 500);
    }
  }

  // ── Profile: 2FA setup ──
  if (path === '/profile/2fa/setup' && request.method === 'POST') {
    try {
      const { enable } = await request.json();
      if (enable) {
        const secret = generateTOTPSecret();
        await db.setWebUserTotp(webUser.id, secret, false);
        const qrcode = `otpauth://totp/BotAdmin:${webUser.username}?secret=${secret}&issuer=BotAdmin`;
        return j({ secret, qrcode });
      } else {
        await db.setWebUserTotp(webUser.id, null, false);
        return j({ ok: true });
      }
    } catch {
      return err('操作失败', 500);
    }
  }

  // ── Profile: 2FA verify & enable ──
  if (path === '/profile/2fa/verify' && request.method === 'POST') {
    try {
      const { token: totpToken, secret } = await request.json();
      if (!totpToken || !secret)              return err('缺少参数');
      if (!await verifyTOTP(totpToken, secret)) return err('验证码无效', 400);
      await db.setWebUserTotp(webUser.id, secret, true);
      return j({ ok: true });
    } catch {
      return err('验证失败', 500);
    }
  }

  // ── Settings: get ──
  if (path === '/settings' && request.method === 'GET') {
    try {
      return j(await db.getAllSettings());
    } catch {
      return err('获取设置失败', 500);
    }
  }

  // ── Settings: update ──
  if (path === '/settings' && request.method === 'PUT') {
    try {
      const body    = await request.json();
      const allowed = [
        'BOT_TOKEN', 'FORUM_GROUP_ID', 'ADMIN_IDS',
        'VERIFICATION_ENABLED', 'VERIFICATION_TIMEOUT',
        'MAX_VERIFICATION_ATTEMPTS', 'AUTO_UNBLOCK_ENABLED',
        'MAX_MESSAGES_PER_MINUTE',
      ];
      for (const key of allowed) {
        if (body[key] !== undefined && body[key] !== '') {
          await db.setSetting(key, String(body[key]));
        }
      }
      return j({ ok: true });
    } catch {
      return err('保存设置失败', 500);
    }
  }

  // ── Settings: set webhook ──
  if (path === '/settings/webhook' && request.method === 'POST') {
    try {
      const settings = await db.getAllSettings();
      if (!settings.BOT_TOKEN) return err('请先配置 Bot Token', 400);
      const { webhookUrl } = await request.json();
      if (!webhookUrl)       return err('缺少 webhookUrl', 400);

      const tg  = new TG(settings.BOT_TOKEN);
      let secret = settings.WEBHOOK_SECRET;
      if (!secret) {
        secret = genToken(32);
        await db.setSetting('WEBHOOK_SECRET', secret);
      }
      const res = await tg.setWebhook({ url: webhookUrl, secret });
      if (!res.ok) return err('设置失败: ' + res.description);
      return j({ ok: true, message: 'Webhook 设置成功' });
    } catch {
      return err('设置 Webhook 失败', 500);
    }
  }

  // ── Settings: test token ──
  if (path === '/settings/test-token' && request.method === 'POST') {
    try {
      const { token: botToken } = await request.json();
      if (!botToken) return err('缺少 token', 400);
      const res = await new TG(botToken).getMe();
      if (!res.ok) return err('Token 无效: ' + res.description);
      return j({ ok: true, bot: res.result });
    } catch {
      return err('测试失败', 500);
    }
  }

  // ── TG: resolve chat ──
  if (path === '/tg/resolve-chat' && request.method === 'POST') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err('Bot Token 未配置', 400);
      const { chatId } = await request.json();
      if (!chatId)    return err('缺少 chatId', 400);

      const numericId =
        typeof chatId === 'string' && /^-?\d+$/.test(chatId)
          ? parseInt(chatId, 10)
          : chatId;

      const res = await new TG(botToken).getChat(numericId);
      if (!res.ok) return err('无法获取信息: ' + res.description);
      return j({ ok: true, chat: res.result });
    } catch {
      return err('解析失败', 500);
    }
  }

  // ── TG: get bot info ──
  if (path === '/tg/me' && request.method === 'GET') {
    try {
      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err('Bot Token 未配置', 400);
      const res = await new TG(botToken).getMe();
      if (!res.ok) return err(res.description);
      return j({ ok: true, bot: res.result });
    } catch {
      return err('获取 Bot 信息失败', 500);
    }
  }

  // ── Users: search ──
  if (path === '/users/search' && request.method === 'GET') {
    try {
      const q = url.searchParams.get('q') || '';
      if (q.length < 1) return j([]);
      return j(await db.searchUsers(q, 15));
    } catch {
      return err('搜索失败', 500);
    }
  }

  // ── Conversations: list ──
  if (path === '/conversations' && request.method === 'GET') {
    try {
      return j(await db.getRecentConvs(50));
    } catch {
      return err('获取对话失败', 500);
    }
  }

  // ── Conversations: detail ──
  const convMatch = path.match(/^\/conversations\/(\d+)$/);
  if (convMatch && request.method === 'GET') {
    try {
      const uid  = parseInt(convMatch[1], 10);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const [user, messages] = await Promise.all([
        db.getUser(uid),
        db.getMsgs(uid, 50, (page - 1) * 50),
      ]);
      return j({ user, messages });
    } catch {
      return err('获取消息失败', 500);
    }
  }

  // ── Users: list ──
  if (path === '/users' && request.method === 'GET') {
    try {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      return j(await db.getAllUsers(page, 20));
    } catch {
      return err('获取用户列表失败', 500);
    }
  }

  // ── Users: block / unblock ──
  const blockMatch = path.match(/^\/users\/(\d+)\/(block|unblock)$/);
  if (blockMatch && request.method === 'PUT') {
    try {
      const uid    = parseInt(blockMatch[1], 10);
      const action = blockMatch[2];
      const body   = await request.json();
      if (action === 'block') {
        await db.blockUser(uid, body.reason || 'WebUI封禁', webUser.id, body.permanent !== false);
      } else {
        await db.unblockUser(uid);
      }
      return j({ ok: true });
    } catch {
      return err('操作失败', 500);
    }
  }

  // ── Stats ──
  if (path === '/stats' && request.method === 'GET') {
    try {
      return j(await db.getStats());
    } catch {
      return err('获取统计失败', 500);
    }
  }

  return err('接口不存在', 404);
}
