// functions/api/routes/whitelist.js
// 白名单路由
import { j, err } from '../../_shared/api-utils.js';
import { logAuditAction } from '../../_shared/audit-log.js';

/**
 * 处理白名单路由
 * @returns {Response|null} null 表示不匹配
 */
export async function handleWhitelistRoutes(path, request, ctx) {
  const { db, kv } = ctx;
  const t = ctx.t;
  const url = new URL(request.url);

  // 白名单列表
  if (path === '/whitelist' && request.method === 'GET') {
    return j(await db.getWhitelist(parseInt(url.searchParams.get('page') || '1', 10), 20));
  }

  // 检查单个用户白名单状态
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

  // 添加/移除白名单
  const wlMatch = path.match(/^\/whitelist\/(\d+)$/);
  if (wlMatch && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      await db.addToWhitelist(parseInt(wlMatch[1], 10), body.reason || '', ctx.webUser.id);
      await logAuditAction(db, kv, 'whitelist.add', ctx.webUser.id, { uid: parseInt(wlMatch[1], 10), reason: body.reason });
      return j({ ok: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }
  if (wlMatch && request.method === 'DELETE') {
    try {
      await db.removeFromWhitelist(parseInt(wlMatch[1], 10));
      await logAuditAction(db, kv, 'whitelist.remove', ctx.webUser.id, { uid: parseInt(wlMatch[1], 10) });
      return j({ ok: true });
    } catch {
      return err(t('users.operationFailed'), 500);
    }
  }

  return null;
}
