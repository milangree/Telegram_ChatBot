// functions/api/routes/profile.js
// 个人资料路由（需要登录）
import {
  verifyPw, createSession, validatePassword, bumpSessionEpoch, delSessionsForUser,
} from '../../_shared/auth.js';
import { generateTOTPSecret, verifyTOTP } from '../../_shared/totp.js';
import { isBootstrapAdminDisabled } from '../../_shared/admin-bootstrap.js';
import { j, err, getLoginSessionTtl, cookie, isSecureRequest } from '../../_shared/api-utils.js';
import { logError } from '../../_shared/error-handler.js';

/**
 * 处理个人资料路由
 * @returns {Response|null} null 表示不匹配
 */
export async function handleProfileRoutes(path, request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  const webUser = ctx.webUser;

  // 修改用户名
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

  // 修改密码
  if (path === '/profile/password' && request.method === 'PUT') {
    try {
      const { oldPassword, newPassword } = await request.json();
      if (!oldPassword || !newPassword) return err(t('common.missingParams'));
      if (!await verifyPw(oldPassword, webUser.password_hash)) return err(t('profile.oldPasswordWrong'), 401);
      if (!validatePassword(newPassword)) return err(t('auth.passwordMin'));
      const { rotatePasswordAndRevokeSessions } = await import('../../_shared/auth.js');
      await rotatePasswordAndRevokeSessions({ db, kv, userId: webUser.id, newPassword });
      return j({ ok: true, reLogin: true });
    } catch {
      return err(t('profile.updateFailed'), 500);
    }
  }

  // 2FA 设置
  if (path === '/profile/2fa/setup' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const enable = body?.enable;
      if (enable) {
        if (webUser.totp_enabled) return err(t('profile.operationFailed'), 400);
        const secret = generateTOTPSecret();
        await db.setWebUserTotp(webUser.id, secret, false);
        return j({ secret, qrcode: `otpauth://totp/BotAdmin:${webUser.username}?secret=${secret}&issuer=BotAdmin` });
      }

      // 关闭 2FA
      if (!webUser.totp_enabled) {
        await db.setWebUserTotp(webUser.id, null, false);
        return j({ ok: true });
      }
      const { password, totp: totpCode } = body || {};
      if (!password || !totpCode) return err(t('common.missingParams'));
      if (!await verifyPw(password, webUser.password_hash)) return err(t('profile.oldPasswordWrong'), 401);
      if (!await verifyTOTP(totpCode, webUser.totp_secret)) return err(t('profile.invalidTotp'), 400);

      await db.setWebUserTotp(webUser.id, null, false);
      await bumpSessionEpoch(kv, webUser.id);
      await delSessionsForUser(kv, webUser.id);
      const sessionTtl = await getLoginSessionTtl(db);
      const newToken = await createSession(kv, webUser.id, sessionTtl);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie(newToken, sessionTtl, { secure: isSecureRequest(request) }),
        },
      });
    } catch {
      return err(t('profile.operationFailed'), 500);
    }
  }

  // 2FA 验证
  if (path === '/profile/2fa/verify' && request.method === 'POST') {
    try {
      const { token: totpToken } = await request.json();
      if (!totpToken) return err(t('common.missingParams'));
      const pendingSecret = webUser.totp_secret;
      if (!pendingSecret || webUser.totp_enabled) return err(t('profile.operationFailed'), 400);
      if (!await verifyTOTP(totpToken, pendingSecret)) return err(t('profile.invalidTotp'), 400);
      await db.setWebUserTotp(webUser.id, pendingSecret, true);
      return j({ ok: true });
    } catch {
      return err(t('profile.verifyFailed'), 500);
    }
  }

  return null;
}
