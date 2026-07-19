// functions/api/miniapp/[[path]].js
// Telegram Mini App 后端：catch-all 路由。
// 鉴权方式：登录时校验 initData 验签 -> 下发 Bearer token；后续请求带 Authorization: Bearer <token>。
// 严格遵循 session.tgUserId 查询当前用户数据，拒收 body/query 的 userId；管理员判定每次请求重读 ADMIN_IDS。
import { DB } from '../../_shared/db.js';
import { TG, name, esc } from '../../_shared/tg.js';
import { CORS, j, err, checkLoginRateLimit, clearLoginFailures } from '../../_shared/auth.js';
import {
  verifyInitData,
  createMiniAppSession,
  getMiniAppSession,
  delMiniAppSession,
  extractMiniAppToken,
  requireMiniAppAuth,
} from '../../_shared/miniapp-auth.js';
import { createT, normalizeLocale } from '../../../shared/i18n.js';

// ── 设置脱敏（与 functions/api/[[path]].js 保持一致） ─────────────────────────
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

function maskSettingsForClient(settings) {
  const out = { ...(settings || {}) };
  for (const key of SECRET_SETTING_KEYS) {
    if (key in out) out[key] = maskSecretValue(out[key]);
  }
  return out;
}

// Mini App 允许修改的设置字段白名单（不含 ADMIN_IDS、密钥类、BOT_TOKEN/WEBHOOK_URL/CAPTCHA_SITE_URL/LOGIN_*/ACTIVE_DB/FORUM_GROUP_ID 等）
const SETTINGS_PUT_WHITELIST = [
  'VERIFICATION_ENABLED', 'VERIFICATION_TIMEOUT', 'MAX_VERIFICATION_ATTEMPTS',
  'AUTO_UNBLOCK_ENABLED', 'MAX_MESSAGES_PER_MINUTE',
  'INLINE_KB_MSG_DELETE_ENABLED', 'INLINE_KB_MSG_DELETE_SECONDS',
  'USER_MSG_DELETE_SECONDS', 'CAPTCHA_TYPE',
  'WELCOME_ENABLED', 'WELCOME_MESSAGE', 'BOT_COMMAND_FILTER', 'WHITELIST_ENABLED',
  'ADMIN_NOTIFY_ENABLED', 'BOT_LOCALE', 'ZALGO_FILTER_ENABLED', 'MESSAGE_FILTER_RULES',
];

// ── 通用工具（本地定义，避免改动 [[path]].js） ───────────────────────────────
function parseAdminIds(str) {
  return String(str || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n));
}

/** 分页大小钳制；Mini App 上限 50，默认 20 */
function clampPageSize(value, fallback = 20, max = 50) {
  const parsed = parseInt(value || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function getLoginSessionTtl(db) {
  const raw = await db.getSetting('LOGIN_SESSION_TTL');
  return Math.max(300, parseInt(raw || '86400', 10) || 86400);
}

/** Mini App 翻译器，key 命名空间 api.miniapp.* */
function getMiniAppTranslator(request, fallbackLocale = 'zh-hans') {
  const preferred = request.headers.get('X-Locale') || request.headers.get('Accept-Language') || fallbackLocale;
  const normalized = normalizeLocale(String(preferred).split(',')[0].trim());
  const base = createT(normalized);
  return (key, params = {}) => base(`api.miniapp.${key}`, params);
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

/** 管理员鉴权：区分 401（未登录/会话失效）与 403（非管理员） */
async function guardAdmin(request, kv, db, t) {
  const auth = await requireMiniAppAuth(request, kv, db);
  if (!auth) {
    const hasToken = !!extractMiniAppToken(request);
    return { error: err(t(hasToken ? 'sessionExpired' : 'unauthorized'), 401) };
  }
  if (!auth.isAdmin) return { error: err(t('forbidden'), 403) };
  return { auth };
}

/** 普通用户鉴权：区分 401（未登录）与 401（会话失效） */
async function guardUser(request, kv, db, t) {
  const auth = await requireMiniAppAuth(request, kv, db);
  if (!auth) {
    const hasToken = !!extractMiniAppToken(request);
    return { error: err(t(hasToken ? 'sessionExpired' : 'unauthorized'), 401) };
  }
  return { auth };
}

export async function onRequest({ request, env, waitUntil }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (!env.KV) {
    const t = getMiniAppTranslator(request);
    return err(t('kvNotBound'), 500);
  }

  const db = new DB(env.KV, env.D1 || null, env.HYPERDRIVE || null);
  await db.autoRepair();
  const kv = env.KV;
  const t = getMiniAppTranslator(request, await db.getSetting('BOT_LOCALE'));
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/miniapp/, '') || '/';

  // ═══════════════════════════════════════════════
  // 公开路由
  // ═══════════════════════════════════════════════

  // 登录：校验 initData 验签 -> 下发 Bearer token
  if (path === '/auth/login' && request.method === 'POST') {
    try {
      const { initData } = await request.json().catch(() => ({}));
      if (!initData || typeof initData !== 'string') return err(t('invalidParams'), 400);

      const botToken = await db.getSetting('BOT_TOKEN');
      if (!botToken) return err(t('botTokenNotConfigured'), 500);

      const verified = await verifyInitData(initData, botToken, 3600);
      if (!verified || !verified.user || !verified.user.id) {
        return err(t('loginFailed'), 401);
      }

      const u = verified.user;
      const tgId = Number(u.id);
      // 登录后按用户 ID 限流，防止暴力重试
      const rlKey = `miniapp_login:${tgId}`;
      const rl = await checkLoginRateLimit(kv, rlKey, 5, 60);
      if (rl.locked) return err(t('rateLimited'), 429);
      await clearLoginFailures(kv, rlKey);
      // Mini App 也作为可信 Telegram 身份来源：同步基础资料，保留既有验证/封禁/话题状态
      // 这样首次从 Mini App 进入、尚未与 Bot 私聊的用户，/me 与管理员列表也能显示完整资料。
      await db.upsertUser({
        user_id: tgId,
        username: u.username || null,
        first_name: u.first_name || null,
        last_name: u.last_name || null,
        language_code: u.language_code || null,
      });

      const adminIds = parseAdminIds(await db.getSetting('ADMIN_IDS'));
      const isAdmin = adminIds.includes(tgId);
      const ttl = await getLoginSessionTtl(db);
      const token = await createMiniAppSession(kv, tgId, isAdmin, ttl);

      return j({
        token,
        user: {
          id: u.id,
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          username: u.username || '',
          language_code: u.language_code || '',
          is_premium: !!u.is_premium,
        },
        isAdmin,
      });
    } catch (e) {
      console.error('[miniapp] login error:', e?.message || e);
      return err(t('loginFailed'), 500);
    }
  }

  // 登出：删除当前会话
  if (path === '/auth/logout' && request.method === 'POST') {
    const token = extractMiniAppToken(request);
    if (token) await delMiniAppSession(kv, token).catch(() => {});
    return j({ ok: true });
  }

  // ═══════════════════════════════════════════════
  // 普通用户路由（requireMiniAppAuth，硬编码 tgUserId = session.tgUserId）
  // ═══════════════════════════════════════════════

  // 我的信息：合并 DB 用户记录与状态字段
  if (path === '/me' && request.method === 'GET') {
    const g = await guardUser(request, kv, db, t);
    if (g.error) return g.error;
    const { tgUserId, isAdmin } = g.auth;
    try {
      const dbUser = await db.getUser(tgUserId);
      const isWhitelisted = await db.isWhitelisted(tgUserId).catch(() => false);
      const user = dbUser
        ? { ...dbUser, id: tgUserId }
        : { user_id: tgUserId, id: tgUserId };
      return j({
        user,
        isAdmin,
        isVerified: !!dbUser?.is_verified,
        isBlocked: !!dbUser?.is_blocked,
        isPermanentBlock: !!dbUser?.is_permanent_block,
        blockReason: dbUser?.block_reason || '',
        isWhitelisted: !!isWhitelisted,
      });
    } catch (e) {
      console.error('[miniapp] /me error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 我的对话：可选 since 增量
  if (path === '/my/conversations' && request.method === 'GET') {
    const g = await guardUser(request, kv, db, t);
    if (g.error) return g.error;
    const { tgUserId } = g.auth;
    try {
      const since = String(url.searchParams.get('since') || '').trim();
      const limit = clampPageSize(url.searchParams.get('limit'), 50, 50);
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const items = since
        ? await db.getMsgsSince(tgUserId, since, limit)
        : await db.getMsgs(tgUserId, limit, (page - 1) * limit);
      return j({
        items,
        mode: since ? 'delta' : 'full',
        serverTime: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[miniapp] /my/conversations error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 我的状态：验证 / 封禁 / 是否可申诉
  if (path === '/my/status' && request.method === 'GET') {
    const g = await guardUser(request, kv, db, t);
    if (g.error) return g.error;
    const { tgUserId } = g.auth;
    try {
      const dbUser = await db.getUser(tgUserId);
      const isBlocked = !!dbUser?.is_blocked;
      const isPermanentBlock = !!dbUser?.is_permanent_block;
      const autoUnblock = (await db.getSetting('AUTO_UNBLOCK_ENABLED')) === 'true';
      const isWhitelisted = await db.isWhitelisted(tgUserId).catch(() => false);
      return j({
        isVerified: !!dbUser?.is_verified,
        isBlocked,
        isPermanentBlock,
        blockReason: dbUser?.block_reason || '',
        canAppeal: isBlocked && !isPermanentBlock && autoUnblock,
        isWhitelisted: !!isWhitelisted,
      });
    } catch (e) {
      console.error('[miniapp] /my/status error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 提交申诉：防滥用 + TG 通知管理员
  if (path === '/my/appeal' && request.method === 'POST') {
    const g = await guardUser(request, kv, db, t);
    if (g.error) return g.error;
    const { tgUserId } = g.auth;
    try {
      const { text } = await request.json().catch(() => ({}));
      const appealText = String(text || '').trim();
      // 长度限制：与前端约定 10-2000 字符；过短/过长均拒绝，避免超长申诉触发 Telegram 4096 字符上限导致通知静默丢失
      if (appealText.length < 10 || appealText.length > 2000) return err(t('invalidParams'), 400);

      const dbUser = await db.getUser(tgUserId);
      const isBlocked = !!dbUser?.is_blocked;
      const isPermanentBlock = !!dbUser?.is_permanent_block;
      const autoUnblock = (await db.getSetting('AUTO_UNBLOCK_ENABLED')) === 'true';
      const canAppeal = isBlocked && !isPermanentBlock && autoUnblock;
      if (!canAppeal) return err(t('appealNotAvailable'), 403);

      // 防滥用：pending_appeal:<tgId> 存在则拒绝（与 bot.js 申诉流程键约定一致，TTL 900s）
      const appealKey = `pending_appeal:${tgUserId}`;
      const existing = await kv.get(appealKey).catch(() => null);
      if (existing) return err(t('appealRateLimited'), 429);

      await kv.put(appealKey, JSON.stringify({ text: appealText, tgUserId, at: Date.now() }), { expirationTtl: 900 });

      // 异步通知管理员，失败不阻塞响应
      const notifyTask = (async () => {
        try {
          const settings = await db.getAllSettings();
          const botToken = settings.BOT_TOKEN;
          if (!botToken) return;
          const tg = new TG(botToken);
          const groupId = parseInt(settings.FORUM_GROUP_ID, 10);
          const adminIds = parseAdminIds(settings.ADMIN_IDS);
          // 使用 bot 命名空间文案，复用既有 approve/reject 回调按钮（apu:/apr:）
          const bt = createT(normalizeLocale(settings.BOT_LOCALE));
          const who = `${name({ id: tgUserId, first_name: dbUser?.first_name, last_name: dbUser?.last_name, username: dbUser?.username })} (${tgUserId})`;
          // 通知文本截断：嵌入模板后可能超 Telegram 单条 4096 字符上限，超长会导致 sendMsg 静默失败、管理员收不到通知
          const notifyText = appealText.length > 1900 ? appealText.slice(0, 1900) + '…' : appealText;
          const appealMessage = bt('bot.appeal.title', { who: esc(who), content: esc(notifyText) });
          const kb = [[
            { text: bt('bot.appeal.approve'), callback_data: `apu:${tgUserId}` },
            { text: bt('bot.appeal.reject'), callback_data: `apr:${tgUserId}` },
          ]];

          // 优先发到用户的话题（管理员在话题群可见），失败回退到管理员私聊
          if (groupId && !isNaN(groupId) && dbUser?.thread_id) {
            const r = await tg.sendMsg({ chatId: groupId, threadId: dbUser.thread_id, text: appealMessage, kb }).catch(() => null);
            if (r?.ok) return;
          }
          for (const aid of adminIds) {
            await tg.sendMsg({ chatId: aid, text: appealMessage, kb }).catch(() => {});
          }
        } catch (e) {
          console.error('[miniapp] appeal notify failed:', e?.message || e);
        }
      })();
      if (waitUntil) waitUntil(notifyTask);
      else notifyTask.catch(() => {});

      return j({ ok: true, submitted: true });
    } catch (e) {
      console.error('[miniapp] /my/appeal error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // ═══════════════════════════════════════════════
  // 管理员路由（requireMiniAppAdmin，非管理员 403）
  // ═══════════════════════════════════════════════

  // 统计
  if (path === '/admin/stats' && request.method === 'GET') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    try {
      return j(await db.getStats());
    } catch (e) {
      console.error('[miniapp] /admin/stats error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 用户列表：?page&pageSize&filter=blocked|normal|all&q
  if (path === '/admin/users' && request.method === 'GET') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    try {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const pageSize = clampPageSize(url.searchParams.get('pageSize'), 20, 50);
      const filter = String(url.searchParams.get('filter') || '').trim();
      const q = String(url.searchParams.get('q') || '').trim();

      let payload;
      if (q) {
        const users = await db.searchUsers(q, pageSize);
        payload = await attachWhitelistFlags(db, { users });
        return j({ users: payload.users, total: users.length });
      }
      if (filter === 'blocked') payload = await db.getBlockedUsers(page, pageSize);
      else if (filter === 'normal') payload = await db.getNormalUsers(page, pageSize);
      else payload = await db.getAllUsers(page, pageSize);
      payload = await attachWhitelistFlags(db, payload);
      return j({ users: payload.users, total: payload.total });
    } catch (e) {
      console.error('[miniapp] /admin/users error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 封禁用户：PUT /admin/users/:id/block
  const blockMatch = path.match(/^\/admin\/users\/(\d+)\/block$/);
  if (blockMatch && request.method === 'PUT') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    const { auth } = g;
    try {
      const uid = parseInt(blockMatch[1], 10);
      const adminIds = parseAdminIds(await db.getSetting('ADMIN_IDS'));
      if (adminIds.includes(uid)) return err(t('cannotBanAdmin'), 400);
      const body = await request.json().catch(() => ({}));
      const reason = String(body.reason || '').trim();
      const permanent = body.permanent === true;
      await db.blockUser(uid, reason, auth.tgUserId, permanent);
      console.log(`[miniapp] admin ${auth.tgUserId} blocked user ${uid} (permanent=${permanent})`);
      return j({ ok: true });
    } catch (e) {
      console.error('[miniapp] block error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 解封用户：PUT /admin/users/:id/unblock
  const unblockMatch = path.match(/^\/admin\/users\/(\d+)\/unblock$/);
  if (unblockMatch && request.method === 'PUT') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    const { auth } = g;
    try {
      const uid = parseInt(unblockMatch[1], 10);
      await db.unblockUser(uid);
      console.log(`[miniapp] admin ${auth.tgUserId} unblocked user ${uid}`);
      return j({ ok: true });
    } catch (e) {
      console.error('[miniapp] unblock error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 白名单列表：GET /admin/whitelist?page&pageSize
  if (path === '/admin/whitelist' && request.method === 'GET') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    try {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const pageSize = clampPageSize(url.searchParams.get('pageSize'), 20, 50);
      return j(await db.getWhitelist(page, pageSize));
    } catch (e) {
      console.error('[miniapp] whitelist list error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 加入白名单：POST /admin/whitelist/:id
  const wlAddMatch = path.match(/^\/admin\/whitelist\/(\d+)$/);
  if (wlAddMatch && request.method === 'POST') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    const { auth } = g;
    try {
      const uid = parseInt(wlAddMatch[1], 10);
      const body = await request.json().catch(() => ({}));
      const reason = String(body.reason || '').trim();
      await db.addToWhitelist(uid, reason, auth.tgUserId);
      console.log(`[miniapp] admin ${auth.tgUserId} whitelisted user ${uid}`);
      return j({ ok: true });
    } catch (e) {
      console.error('[miniapp] whitelist add error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 移出白名单：DELETE /admin/whitelist/:id
  if (wlAddMatch && request.method === 'DELETE') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    const { auth } = g;
    try {
      const uid = parseInt(wlAddMatch[1], 10);
      await db.removeFromWhitelist(uid);
      console.log(`[miniapp] admin ${auth.tgUserId} removed whitelist user ${uid}`);
      return j({ ok: true });
    } catch (e) {
      console.error('[miniapp] whitelist remove error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 最近对话列表：GET /admin/conversations?since&limit
  if (path === '/admin/conversations' && request.method === 'GET') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    try {
      const since = String(url.searchParams.get('since') || '').trim();
      const limit = clampPageSize(url.searchParams.get('limit'), 50, 50);
      const items = since
        ? await db.getRecentConvsSince(since, limit)
        : await db.getRecentConvs(limit);
      return j({
        items,
        mode: since ? 'delta' : 'full',
        serverTime: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[miniapp] /admin/conversations error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 指定用户的对话：GET /admin/conversations/:id?since&page（管理员可查任意用户）
  const adminConvMatch = path.match(/^\/admin\/conversations\/(\d+)$/);
  if (adminConvMatch && request.method === 'GET') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    try {
      const uid = parseInt(adminConvMatch[1], 10);
      const since = String(url.searchParams.get('since') || '').trim();
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const limit = clampPageSize(url.searchParams.get('limit'), 50, 50);
      const [user, messages] = await Promise.all([
        db.getUser(uid),
        since ? db.getMsgsSince(uid, since, limit) : db.getMsgs(uid, limit, (page - 1) * limit),
      ]);
      return j({
        user,
        messages,
        mode: since ? 'delta' : 'full',
        serverTime: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[miniapp] /admin/conversations/:id error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 设置（GET 脱敏）
  if (path === '/admin/settings' && request.method === 'GET') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    try {
      return j(maskSettingsForClient(await db.getAllSettings()));
    } catch (e) {
      console.error('[miniapp] /admin/settings GET error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 设置（PUT 仅白名单字段，密钥类一律忽略）
  if (path === '/admin/settings' && request.method === 'PUT') {
    const g = await guardAdmin(request, kv, db, t);
    if (g.error) return g.error;
    const { auth } = g;
    try {
      const body = await request.json().catch(() => ({}));
      const changed = [];
      for (const key of SETTINGS_PUT_WHITELIST) {
        if (body[key] === undefined) continue;
        // 密钥字段即便误入白名单也忽略（双重保险）
        if (SECRET_SETTING_KEYS.includes(key)) continue;
        const value = key === 'BOT_LOCALE'
          ? normalizeLocale(body[key])
          : String(body[key]);
        await db.setSetting(key, value);
        changed.push(key);
      }
      console.log(`[miniapp] admin ${auth.tgUserId} updated settings: ${changed.join(', ') || '(none)'}`);
      return j({ ok: true, settings: maskSettingsForClient(await db.getAllSettings()) });
    } catch (e) {
      console.error('[miniapp] /admin/settings PUT error:', e?.message || e);
      return err(t('operationFailed'), 500);
    }
  }

  // 未匹配路由：自然 404（不实现 SQL 导入导出 / 清空数据 / DB 切换 / Webhook / 测试 token / profile 等）
  return err(t('notFound'), 404);
}
