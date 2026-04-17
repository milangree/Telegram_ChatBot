// functions/_shared/auth.js
const DEFAULT_TTL = 86400;

export function genToken(len = 48) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, b => c[b % c.length]).join('');
}

async function sha256(m) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function hashPw(pw) {
  const s = genToken(16);
  return `${s}:${await sha256(`${s}:${pw}`)}`;
}

export async function verifyPw(pw, stored) {
  const [s, h] = stored.split(':');
  return await sha256(`${s}:${pw}`) === h;
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
