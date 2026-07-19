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
function timingSafeEqualStr(a, b) {
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

/** 哈希密码：pbkdf2:iterations:salt:hash（兼容旧格式 salt:sha256hash） */
export async function hashPw(pw) {
  const s = genToken(16);
  const h = await pbkdf2Hash(pw, s);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${s}:${h}`;
}

/** 验证密码：支持新格式 pbkdf2 和旧格式 sha256 */
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
  // 兼容旧格式 salt:sha256hash
  const [s, h] = stored.split(':');
  if (!s || !h) return false;
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${s}:${pw}`));
  return timingSafeEqualStr(toHex(b), h);
}

export async function createSession(kv, userId, ttlSeconds = DEFAULT_TTL) {
  const ttl = Math.max(300, parseInt(ttlSeconds, 10) || DEFAULT_TTL);
  const token = genToken();
  const sessionData = { userId, exp: Date.now() + ttl * 1000 };
  await kv.put(`sess:${token}`, JSON.stringify(sessionData), { expirationTtl: ttl });
  // 用户维度索引，便于改密后吊销全部会话
  await kv.put(`sess_user:${userId}:${token}`, '1', { expirationTtl: ttl }).catch(() => {});
  return token;
}

export async function getSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(`sess:${token}`);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (Date.now() > s.exp) {
    await kv.delete(`sess:${token}`);
    if (s.userId) await kv.delete(`sess_user:${s.userId}:${token}`).catch(() => {});
    return null;
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

/** 吊销某用户的全部会话（改密 / 找回密码后调用） */
export async function delSessionsForUser(kv, userId) {
  if (!kv || userId == null) return 0;
  const prefix = `sess_user:${userId}:`;
  let deleted = 0;
  let cursor;
  do {
    const page = await kv.list({ prefix, limit: 200, ...(cursor ? { cursor } : {}) });
    const keys = page?.keys || [];
    for (const item of keys) {
      const name = item?.name || item;
      if (!name || !String(name).startsWith(prefix)) continue;
      const token = String(name).slice(prefix.length);
      if (token) {
        await kv.delete(`sess:${token}`).catch(() => {});
        await kv.delete(name).catch(() => {});
        deleted++;
      }
    }
    cursor = page?.list_complete === false ? page.cursor : null;
  } while (cursor);

  // 兼容旧会话（无 sess_user 索引）：扫描 sess: 前缀
  if (deleted === 0 && typeof kv.list === 'function') {
    cursor = undefined;
    do {
      const page = await kv.list({ prefix: 'sess:', limit: 200, ...(cursor ? { cursor } : {}) });
      const keys = page?.keys || [];
      for (const item of keys) {
        const name = item?.name || item;
        if (!name || !String(name).startsWith('sess:')) continue;
        const raw = await kv.get(name).catch(() => null);
        if (!raw) continue;
        try {
          const s = JSON.parse(raw);
          if (s?.userId === userId) {
            await kv.delete(name).catch(() => {});
            deleted++;
          }
        } catch { /* noop */ }
      }
      cursor = page?.list_complete === false ? page.cursor : null;
    } while (cursor);
  }
  return deleted;
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
  if (!raw) return { locked: false, remaining: maxAtt, count: 0 };
  let data;
  try { data = JSON.parse(raw); } catch { return { locked: false, remaining: maxAtt, count: 0 }; }
  // 锁定期已过：清零计数，避免过期后一次失败立刻再锁
  if (data.exp && data.exp <= Date.now()) {
    await kv.delete(key).catch(() => {});
    return { locked: false, remaining: maxAtt, count: 0 };
  }
  if (data.count >= maxAtt && data.exp > Date.now()) {
    return { locked: true, remaining: 0, retryAfter: Math.ceil((data.exp - Date.now()) / 1000), count: data.count };
  }
  return { locked: false, remaining: Math.max(0, maxAtt - (data.count || 0)), count: data.count || 0 };
}

/** 记录一次登录失败 */
export async function recordLoginFailure(kv, username, lockoutSeconds) {
  const lockout = lockoutSeconds || DEFAULT_LOGIN_LOCKOUT_SECONDS;
  const key = `login_fail:${(username || '').toLowerCase()}`;
  const raw = await kv.get(key);
  let data = { count: 0, exp: 0 };
  if (raw) {
    try {
      data = JSON.parse(raw);
      // 过期后重新计数
      if (data.exp && data.exp <= Date.now()) data = { count: 0, exp: 0 };
    } catch {
      data = { count: 0, exp: 0 };
    }
  }
  data.count = (data.count || 0) + 1;
  data.exp = Date.now() + lockout * 1000;
  await kv.put(key, JSON.stringify(data), { expirationTtl: lockout + 10 });
}

/** 清除登录失败计数（登录成功时调用） */
export async function clearLoginFailures(kv, username) {
  await kv.delete(`login_fail:${(username || '').toLowerCase()}`).catch(() => {});
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
