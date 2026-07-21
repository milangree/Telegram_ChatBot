// functions/_shared/auth.js
const DEFAULT_TTL = 86400;
// Cloudflare Workers 限制 PBKDF2 最多 100000 次迭代（环境差异）
const PBKDF2_ITERATIONS = 100000;

export function genToken(len = 48) {
  // 使用无偏差随机：rejection sampling，避免 b % 62 模偏差
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const out = [];
  while (out.length < len) {
    const a = new Uint8Array(len - out.length + 8);
    crypto.getRandomValues(a);
    for (const b of a) {
      if (b >= 248) continue; // 248 = 62 * 4，拒绝偏差区间
      out.push(c[b % 62]);
      if (out.length >= len) break;
    }
  }
  return out.join('');
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

/** 恒定时间比较，降低时序侧信道风险 */
export function timingSafeEqualStr(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const len = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function pbkdf2Hash(password, salt, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return toHex(bits);
}

/** 常见弱口令（小写比较） */
const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123',
  '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'qwerty1234', 'abc123',
  'admin', 'admin123', 'admin1234', 'admin12345', 'admin123456',
  'letmein', 'welcome', 'welcome1', 'welcome123', 'iloveyou',
  '111111', '000000', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
  'root', 'toor', 'test', 'test123', 'test1234', 'test12345',
  'changeme', 'default', 'botadmin', 'telegram', 'telegram1',
])

/**
 * 密码策略：
 * - 至少 10 位
 * - 至少包含字母与数字
 * - 拒绝常见弱口令
 * 返回 true 表示通过；失败原因可用 validatePasswordReason。
 */
export function validatePassword(password) {
  return validatePasswordReason(password) === null
}

export function validatePasswordReason(password) {
  if (typeof password !== 'string') return 'type'
  if (password.length < 10) return 'min'
  if (password.length > 128) return 'max'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'complexity'
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) return 'common'
  return null
}

/** 是否为旧版 salt:sha256 哈希（登录成功后应 rehash） */
export function isLegacyPasswordHash(stored) {
  if (!stored || typeof stored !== 'string') return false
  if (stored.startsWith('pbkdf2:') || stored.startsWith('!!disabled:')) return false
  const parts = stored.split(':')
  return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1])
}

/** 哈希密码：pbkdf2:iterations:salt:hash（兼容旧格式 salt:sha256hash） */
export async function hashPw(pw) {
  const s = genToken(16);
  const h = await pbkdf2Hash(pw, s);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${s}:${h}`;
}

/** 是否允许校验旧版 salt:sha256（默认拒绝；迁移期可设 ALLOW_LEGACY_PASSWORD_HASH=1） */
export function allowLegacyPasswordHash() {
  try {
    if (typeof process !== 'undefined' && process?.env) {
      const v = process.env.ALLOW_LEGACY_PASSWORD_HASH
      return v === '1' || String(v || '').toLowerCase() === 'true'
    }
  } catch { /* Workers */ }
  return false
}

/**
 * 验证密码：新格式 pbkdf2；旧 salt:sha256 默认拒绝（限期禁用）。
 * 迁移窗口：ALLOW_LEGACY_PASSWORD_HASH=1 时仍可校验并应在登录后 rehash。
 */
export async function verifyPw(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (stored.startsWith('!!disabled:')) return false;
  if (stored.startsWith('pbkdf2:')) {
    const parts = stored.split(':');
    if (parts.length !== 4) return false;
    const iter = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
    const salt = parts[2];
    const hash = parts[3];
    const h = await pbkdf2Hash(pw, salt, iter);
    return timingSafeEqualStr(h, hash);
  }
  // 旧格式 salt:sha256hash — 默认禁用
  if (!allowLegacyPasswordHash()) return false;
  const [s, h] = stored.split(':');
  if (!s || !h) return false;
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${s}:${pw}`));
  return timingSafeEqualStr(toHex(b), h);
}

export async function createSession(kv, userId, ttlSeconds = DEFAULT_TTL) {
  const ttl = Math.max(300, parseInt(ttlSeconds, 10) || DEFAULT_TTL);
  const token = genToken();
  const epoch = await getSessionEpoch(kv, userId)
  const sessionData = { userId, exp: Date.now() + ttl * 1000, epoch };
  await kv.put(`sess:${token}`, JSON.stringify(sessionData), { expirationTtl: ttl });
  // 用户维度索引，便于改密后吊销全部会话
  await kv.put(`sess_user:${userId}:${token}`, '1', { expirationTtl: ttl }).catch(() => {});
  return token;
}

async function getSessionEpoch(kv, userId) {
  return await kv.get(`auth:session_epoch:${userId}`) || '0'
}

export async function bumpSessionEpoch(kv, userId) {
  const epoch = genToken(24)
  await kv.put(`auth:session_epoch:${userId}`, epoch)
  return epoch
}

export async function getSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(`sess:${token}`);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || !s.userId || !Number.isFinite(s.exp)) return null
  if (Date.now() > s.exp) {
    await kv.delete(`sess:${token}`);
    if (s.userId) await kv.delete(`sess_user:${s.userId}:${token}`).catch(() => {});
    return null;
  }
  const currentEpoch = await getSessionEpoch(kv, s.userId)
  if (String(s.epoch || '0') !== String(currentEpoch)) {
    await kv.delete(`sess:${token}`).catch(() => {})
    await kv.delete(`sess_user:${s.userId}:${token}`).catch(() => {})
    return null
  }
  return s;
}

export async function delSession(kv, token) {
  if (!token) return;
  const raw = await kv.get(`sess:${token}`).catch(() => null);
  await kv.delete(`sess:${token}`);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s?.userId) await kv.delete(`sess_user:${s.userId}:${token}`).catch(() => {});
    } catch { /* noop */ }
  }
}

/**
 * 吊销某用户的全部会话（改密 / 找回密码后调用）。
 * 主路径依赖 sess_user: 索引；legacy sess: 全表扫描默认关闭（epoch 已使旧会话失效）。
 * 若需兼容极旧未写索引的会话，可设 env SESSION_LEGACY_SCAN=1。
 */
export async function delSessionsForUser(kv, userId) {
  if (!kv || userId == null) return 0;
  const tokens = new Set()
  let cursor
  do {
    const page = await kv.list({ prefix: `sess_user:${userId}:`, limit: 200, ...(cursor ? { cursor } : {}) })
    for (const item of page?.keys || []) {
      const name = item?.name || item
      const prefix = `sess_user:${userId}:`
      if (name && String(name).startsWith(prefix)) tokens.add(String(name).slice(prefix.length))
    }
    cursor = page?.list_complete === false ? page.cursor : null
  } while (cursor)

  let allowLegacyScan = false
  try {
    allowLegacyScan = typeof process !== 'undefined'
      && process?.env
      && (process.env.SESSION_LEGACY_SCAN === '1' || String(process.env.SESSION_LEGACY_SCAN || '').toLowerCase() === 'true')
  } catch { /* Workers */ }

  if (allowLegacyScan) {
    cursor = undefined
    do {
      const page = await kv.list({ prefix: 'sess:', limit: 200, ...(cursor ? { cursor } : {}) })
      for (const item of page?.keys || []) {
        const name = item?.name || item
        if (!name || !String(name).startsWith('sess:')) continue
        const raw = await kv.get(name).catch(() => null)
        if (!raw) continue
        try {
          const s = JSON.parse(raw)
          if (s?.userId === userId) tokens.add(String(name).slice('sess:'.length))
        } catch { /* noop */ }
      }
      cursor = page?.list_complete === false ? page.cursor : null
    } while (cursor)
  }

  let deleted = 0
  for (const token of tokens) {
    await kv.delete(`sess:${token}`).catch(() => {})
    await kv.delete(`sess_user:${userId}:${token}`).catch(() => {})
    deleted++
  }
  return deleted
}

export async function rotatePasswordAndRevokeSessions({ db, kv, userId, newPassword }) {
  const reason = validatePasswordReason(newPassword)
  if (reason) throw new Error(`password_invalid:${reason}`)
  const passwordHash = await hashPw(newPassword)
  await db.updateWebUserPassword(userId, passwordHash)
  // 先改变 epoch，物理清理失败也不会留下可用旧会话。
  await bumpSessionEpoch(kv, userId)
  await delSessionsForUser(kv, userId)
}

export function extractToken(req) {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

export async function requireAuth(req, kv, db) {
  const token = extractToken(req);
  if (!token) return null;
  const sess = await getSession(kv, token);
  if (!sess) return null;
  return db.getWebUserById(sess.userId);
}

/**
 * CORS：生产默认同源（不反射 Origin），避免 * 扩大跨站滥用面。
 * 如需跨域管理后台，设置 CORS_ORIGIN=https://admin.example.com
 *（多个用逗号分隔）；未配置时不返回 Allow-Origin，浏览器跨站读响应会被拦。
 */
function resolveCorsOrigin() {
  try {
    if (typeof process !== 'undefined' && process?.env?.CORS_ORIGIN) {
      const list = String(process.env.CORS_ORIGIN)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // 不使用 *；若只配一个固定源则回写该源
      if (list.length === 1 && list[0] !== '*') return list[0];
      // 多源时由调用方按请求 Origin 匹配；此处返回 null 表示不默认放开
      if (list.length > 1) return null;
    }
  } catch { /* noop */ }
  return null;
}

export const CORS = (() => {
  const origin = resolveCorsOrigin();
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Locale',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
})();

export const j = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});

export const err = (m, s = 400) => j({ error: m }, s);

// ── 认证速率限制（IP + 用户名双维度） ─────────────────────────────────────
// 失败达到阈值后锁定窗口内拒绝，成功登录/重置后清除对应计数。

export const AUTH_RATE_LIMITS = Object.freeze({
  login: { maxFails: 5, windowSec: 900 },       // 15 分钟 5 次
  recover: { maxFails: 3, windowSec: 1800 },    // 30 分钟 3 次（更严）
  totpStatus: { maxFails: 20, windowSec: 600 }, // 防用户枚举
});

/**
 * 从请求头提取客户端 IP（Cloudflare / 反代 / 直连兜底）。
 * 注意：x-forwarded-for 可被伪造，生产应经可信反代并只信最左侧或 cf-connecting-ip。
 */
export function getClientIp(request) {
  try {
    const cf = request?.headers?.get?.('cf-connecting-ip');
    if (cf && String(cf).trim()) return String(cf).trim().slice(0, 64);
    const xff = request?.headers?.get?.('x-forwarded-for');
    if (xff) {
      const first = String(xff).split(',')[0].trim();
      if (first) return first.slice(0, 64);
    }
    const realIp = request?.headers?.get?.('x-real-ip');
    if (realIp && String(realIp).trim()) return String(realIp).trim().slice(0, 64);
  } catch { /* noop */ }
  return 'unknown';
}

function normalizeRateIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:@-]/g, '_')
    .slice(0, 80) || 'empty';
}

function rateLimitKey(action, kind, identity) {
  return `auth:rl:${action}:${kind}:${normalizeRateIdentity(identity)}`;
}

async function readRateBucket(kv, key) {
  if (!kv) return null;
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const fails = Number(data.fails) || 0;
    const firstAt = Number(data.firstAt) || 0;
    const lockedUntil = Number(data.lockedUntil) || 0;
    return { fails, firstAt, lockedUntil };
  } catch {
    return null;
  }
}

/**
 * 检查是否已触发锁定。
 * @returns {{ allowed: true } | { allowed: false, retryAfterSec: number }}
 */
/**
 * 模糊化重试时间，防止攻击者通过精确时间推断限流窗口。
 * 将秒数模糊为「约 X 分钟」或「约 X 秒」（X 为 ±30% 抖动后的整数）。
 * 小于 60 秒直接返回原文；大于等于 60 秒模糊到分钟级。
 */
export function fuzzRetryTime(seconds) {
  const sec = Math.max(1, Math.ceil(Number(seconds) || 1));
  if (sec < 60) return sec;
  // 抖动 ±30%，取整到 10 秒的倍数，最少 60 秒
  const jitter = 1 + (Math.random() * 0.6 - 0.3); // 0.7 ~ 1.3
  const fuzzy = Math.max(60, Math.round(sec * jitter / 10) * 10);
  return fuzzy;
}

export async function checkAuthRateLimit(kv, action, { ip, username } = {}) {
  const conf = AUTH_RATE_LIMITS[action] || AUTH_RATE_LIMITS.login;
  const now = Date.now();
  const keys = [];
  if (ip) keys.push(rateLimitKey(action, 'ip', ip));
  if (username) keys.push(rateLimitKey(action, 'user', username));
  if (!keys.length) return { allowed: true };

  let worstRetry = 0;
  for (const key of keys) {
    const bucket = await readRateBucket(kv, key);
    if (!bucket) continue;
    if (bucket.lockedUntil && bucket.lockedUntil > now) {
      worstRetry = Math.max(worstRetry, Math.ceil((bucket.lockedUntil - now) / 1000));
    }
  }
  if (worstRetry > 0) return { allowed: false, retryAfterSec: worstRetry };

  // 窗口过期的桶在 record 时重建；此处仅看 lockedUntil
  void conf;
  return { allowed: true };
}

/** 记录一次认证失败；达到阈值则写入 lockedUntil */
export async function recordAuthFailure(kv, action, { ip, username } = {}) {
  if (!kv) return;
  const conf = AUTH_RATE_LIMITS[action] || AUTH_RATE_LIMITS.login;
  const now = Date.now();
  const windowMs = conf.windowSec * 1000;
  const targets = [];
  if (ip) targets.push(rateLimitKey(action, 'ip', ip));
  if (username) targets.push(rateLimitKey(action, 'user', username));

  for (const key of targets) {
    const prev = await readRateBucket(kv, key);
    let fails = 1;
    let firstAt = now;
    let lockedUntil = 0;

    if (prev && prev.firstAt && (now - prev.firstAt) < windowMs) {
      fails = (Number(prev.fails) || 0) + 1;
      firstAt = prev.firstAt;
      lockedUntil = Number(prev.lockedUntil) || 0;
    }

    if (fails >= conf.maxFails) {
      lockedUntil = Math.max(lockedUntil, now + windowMs);
    }

    const payload = JSON.stringify({ fails, firstAt, lockedUntil });
    // TTL：锁定结束或窗口结束后自动清理
    const ttlSec = Math.max(60, Math.ceil(((lockedUntil || (firstAt + windowMs)) - now) / 1000) + 30);
    await kv.put(key, payload, { expirationTtl: ttlSec }).catch(() => {});
  }
}

/** 登录/重置成功后清除失败计数 */
export async function clearAuthFailures(kv, action, { ip, username } = {}) {
  if (!kv) return;
  const targets = [];
  if (ip) targets.push(rateLimitKey(action, 'ip', ip));
  if (username) targets.push(rateLimitKey(action, 'user', username));
  for (const key of targets) {
    await kv.delete(key).catch(() => {});
  }
}

// ── Telegram Web App initData 验签 ──────────────────────────────────────

/**
 * 校验 Telegram Web App initData 签名 + auth_date 新鲜度。
 * 算法详见 https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function verifyInitData(initData, botToken, maxAgeSec = 3600) {
  try {
    if (!initData || typeof initData !== 'string') return null;
    if (!botToken || typeof botToken !== 'string') return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    // data-check-string：按 key 字典序排序
    const dataCheckString = [...params]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const enc = new TextEncoder();
    // 第一层：以 "WebAppData" 为密钥对 botToken 做 HMAC，得到会话密钥
    const secretKey = await crypto.subtle.importKey(
      'raw', enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const secretBuf = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken));

    // 第二层：以会话密钥对 data-check-string 做 HMAC
    const hmacKey = await crypto.subtle.importKey(
      'raw', secretBuf,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const calcBuf = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString));
    const calcHash = toHex(calcBuf);

    // auth_date 新鲜度
    const authDate = parseInt(params.get('auth_date'), 10);
    const now = Math.floor(Date.now() / 1000);
    const fresh = Number.isFinite(authDate) && authDate > 0 && (now - authDate) <= maxAgeSec && authDate <= now + 30;

    if (!timingSafeEqualStr(hash, calcHash) || !fresh) return null;

    let user = {};
    try { user = JSON.parse(params.get('user') || '{}'); } catch { user = {}; }
    return { user, authDate };
  } catch {
    return null;
  }
}
