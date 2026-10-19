// functions/api/routes/users.js
// 用户管理路由
import { TG } from '../../_shared/tg.js';
import { parseAdminIds } from '../../_shared/api-utils.js';
import { j, err, clampPageSize } from '../../_shared/api-utils.js';
import { logError } from '../../_shared/error-handler.js';
import { logAuditAction } from '../../_shared/audit-log.js';

/**
 * 为用户列表附加 is_whitelisted
 * 优化：一次性获取全部白名单，避免 N+1 查询
 */
async function attachWhitelistFlags(db, payload) {
  if (!payload || !Array.isArray(payload.users)) return payload;

  // 一次性获取全部白名单用户 ID
  const wlSet = new Set();
  try {
    const allWhitelist = await db.getWhitelistRaw();
    if (Array.isArray(allWhitelist)) {
      for (const entry of allWhitelist) {
        const uid = entry.user_id ?? entry.userId;
        // eslint-disable-next-line eqeqeq
        if (uid != null) wlSet.add(Number(uid));
      }
    }
  } catch (e) {
    logError('API', 'attachWhitelistFlags', e);
  }

  const users = payload.users.map((u) => {
    if (!u) return u;
    if (u.is_blocked) return { ...u, is_whitelisted: false };
    return { ...u, is_whitelisted: wlSet.has(Number(u.user_id)) };
  });
  return { ...payload, users };
}

/**
 * 处理用户管理路由
 * @returns {Response|null} null 表示不匹配
 */
export async function handleUserRoutes(path, request, ctx) {
  const { db } = ctx;
  const t = ctx.t;
  const url = new URL(request.url);

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
      return new Response(img.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' } });
    } catch {
      return new Response('', { status: 404 });
    }
  }

  // 用户搜索
  if (path === '/users/search' && request.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return j([]);
    return j(await db.searchUsers(q, 15));
  }

  // 用户列表
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

  // 封禁/解封
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
        await db.blockUser(uid, body.reason || t('users.reason.webUi'), ctx.webUser.id, body.permanent === true);
        await logAuditAction(db, kv, 'user.block', ctx.webUser.id, { uid, reason: body.reason, permanent: body.permanent === true });
      } else {
        await db.unblockUser(uid);
        await logAuditAction(db, kv, 'user.unblock', ctx.webUser.id, { uid });
      }
      return j({ ok: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }

  // 删除用户
  const delUserMatch = path.match(/^\/users\/(\d+)$/);
  if (delUserMatch && request.method === 'DELETE') {
    try {
      const uid = parseInt(delUserMatch[1], 10);
      const deleted = await db.deleteUser(uid);
      if (!deleted) return err(t('users.notFound'), 404);
      await logAuditAction(db, kv, 'user.delete', ctx.webUser.id, { uid });
      return j({ ok: true, reVerifyRequired: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }

  // 用户名修改（已移除）
  const unameMatch = path.match(/^\/users\/(\d+)\/username$/);
  if (unameMatch && request.method === 'PUT') return err(t('users.usernameFeatureRemoved'), 410);

  return null;
}
