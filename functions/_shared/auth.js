// functions/_shared/auth.js
const DEFAULT_TTL = 86400;
const PBKDF2_ITERATIONS = 600000;

export function genToken(len = 48) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, b => c[b % c.length]).join('');
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

async function pbkdf2Hash(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return toHex(bits);
}

/** 哈希密码：pbkdf2:iterations:salt:hash（兼容旧格式 salt:sha256hash） */
export async function hashPw(pw) {
  const s = genToken(16);
  const h = await pbkdf2Hash(pw, s);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${s}:${h}`;
}

/** 验证密码：支持新格式 pbkdf2 和旧格式 sha256 */
export async function verifyPw(pw, stored) {
  if (stored.startsWith('pbkdf2:')) {
    const [, iter, salt, hash] = stored.split(':');
    const h = await pbkdf2Hash(pw, salt);
    return h === hash;
  }
  // 兼容旧格式 salt:sha256hash
  const [s, h] = stored.split(':');
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${s}:${pw}`));
  return toHex(b) === h;
}

export async function createSession(kv, userId, ttlSeconds = DEFAULT_TTL) {
  const ttl = Math.max(300, parseInt(ttlSeconds, 10) || DEFAULT_TTL);
  const token = genToken();
  const sessionData = { userId, exp: Date.now() + ttl * 1000 };
  await kv.put(`sess:${token}`, JSON.stringify(sessionData), { expirationTtl: ttl });
  return token;
}

export async function getSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(`sess:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (Date.now() > s.exp) {
    await kv.delete(`sess:${token}`);
    return null;
  }
  return s;
}

export async function delSession(kv, token) {
  if (token) await kv.delete(`sess:${token}`);
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

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const j = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});

export const err = (m, s = 400) => j({ error: m }, s);

// ── 登录速率限制 ────────────────────────────────────────────────────────────
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_LOCKOUT_SECONDS = 900;

/** 检查登录是否被锁定 */
export async function checkLoginRateLimit(kv, username, maxAttempts, lockoutSeconds) {
  const maxAtt = maxAttempts || DEFAULT_LOGIN_MAX_ATTEMPTS;
  const key = `login_fail:${(username || '').toLowerCase()}`;
  const raw = await kv.get(key);
  if (!raw) return { locked: false, remaining: maxAtt };
  const data = JSON.parse(raw);
  if (data.count >= maxAtt && data.exp > Date.now()) {
    return { locked: true, remaining: 0, retryAfter: Math.ceil((data.exp - Date.now()) / 1000) };
  }
  return { locked: false, remaining: maxAtt - data.count };
}

/** 记录一次登录失败 */
export async function recordLoginFailure(kv, username, lockoutSeconds) {
  const lockout = lockoutSeconds || DEFAULT_LOGIN_LOCKOUT_SECONDS;
  const key = `login_fail:${(username || '').toLowerCase()}`;
  const raw = await kv.get(key);
  let data = raw ? JSON.parse(raw) : { count: 0, exp: 0 };
  data.count++;
  data.exp = Date.now() + lockout * 1000;
  await kv.put(key, JSON.stringify(data), { expirationTtl: lockout + 10 });
}

/** 清除登录失败计数（登录成功时调用） */
export async function clearLoginFailures(kv, username) {
  await kv.delete(`login_fail:${(username || '').toLowerCase()}`).catch(() => {});
}
