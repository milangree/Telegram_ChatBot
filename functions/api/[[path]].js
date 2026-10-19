// functions/api/[[path]].js
// 主 API 路由分发器
import { DB } from '../_shared/db.js';
import { ensureAdminInitializedOnce, isBootstrapAdminDisabled } from '../_shared/admin-bootstrap.js';
import { extractToken, getSession } from '../_shared/auth.js';
import { j, err, getApiTranslator, isWebAdmin } from '../_shared/api-utils.js';
import { logError, silentCatch } from '../_shared/error-handler.js';
import { handleAuthRoutes, ensureMiniAppMenu } from './routes/auth.js';
import { handleProfileRoutes } from './routes/profile.js';
import { handleUserRoutes } from './routes/users.js';
import { handleConversationRoutes } from './routes/conversations.js';
import { handleSettingsRoutes } from './routes/settings.js';
import { handleWhitelistRoutes } from './routes/whitelist.js';
import { handleTgRoutes } from './routes/tg.js';

export async function onRequest({ request, env, waitUntil }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
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
    logError('API', 'init', e, { path: new URL(request.url).pathname });
    return err(t('unavailable'), 503);
  }

  t = getApiTranslator(request, await db.getSetting('BOT_LOCALE'));
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  // 自动设置 Mini App 菜单（fire-and-forget）
  if (path !== '/settings/webhook' && path !== '/settings') {
    silentCatch(ensureMiniAppMenu(kv, db), 'API', 'miniAppMenu');
  }

  // 构建共享上下文
  const ctx = { db, kv, env, waitUntil, t };

  // ── 公开路由（无需认证）──────────────────────────────────────────────────
  const publicResponse = await handleAuthRoutes(path, request, ctx);
  if (publicResponse) return publicResponse;

  // ── 认证中间件 ──────────────────────────────────────────────────────────
  const token = extractToken(request);
  if (!token) return err(t('auth.unauthorized'), 401);
  const sess = await getSession(kv, token);
  if (!sess) return err(t('auth.sessionExpired'), 401);
  const webUser = await db.getWebUserById(sess.userId);
  if (!webUser) return err(t('auth.userNotFound'), 401);
  if (await isBootstrapAdminDisabled({ kv, user: webUser })) return err(t('auth.unauthorized'), 401);

  const adminUser = isWebAdmin(webUser);
  ctx.webUser = webUser;

  // 管理类接口需要 is_admin（个人资料除外）
  const isProfilePath = path.startsWith('/profile/');
  if (!isProfilePath && !adminUser) {
    return err(t('auth.forbidden') || t('auth.unauthorized'), 403);
  }

  // ── 认证路由（需要登录）──────────────────────────────────────────────────
  const handlers = [
    handleProfileRoutes,
    handleUserRoutes,
    handleConversationRoutes,
    handleSettingsRoutes,
    handleWhitelistRoutes,
    handleTgRoutes,
  ];

  for (const handler of handlers) {
    const response = await handler(path, request, ctx);
    if (response) return response;
  }

  // 统计
  if (path === '/stats' && request.method === 'GET') {
    return j(await db.getStats());
  }

  return err(t('notFound'), 404);
}
