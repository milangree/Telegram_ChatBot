// functions/_shared/api-utils.js
// API 路由共享工具函数
import { createT, normalizeLocale } from '../../shared/i18n.js';

/** 返回给前端时需要脱敏的密钥字段 */
export const SECRET_SETTING_KEYS = [
  'BOT_TOKEN',
  'WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'RECAPTCHA_SECRET_KEY',
  'RECAPTCHA_V3_SECRET_KEY',
  'HCAPTCHA_SECRET_KEY',
];

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Locale',
};

export function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function err(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function isWebAdmin(user) {
  return Boolean(user && (user.is_admin === 1 || user.is_admin === true || user.is_admin === '1'));
}

export function maskSecretValue(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 4) return '****';
  return `****${s.slice(-4)}`;
}

export function isMaskedOrEmptySecret(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  if (!s) return true;
  return s.startsWith('****');
}

export function maskSettingsForClient(settings) {
  const out = { ...(settings || {}) };
  for (const key of SECRET_SETTING_KEYS) {
    if (key in out) out[key] = maskSecretValue(out[key]);
  }
  return out;
}

export function getApiTranslator(request, fallbackLocale = 'zh-hans') {
  const preferred = request.headers.get('X-Locale') || request.headers.get('Accept-Language') || fallbackLocale;
  const normalized = normalizeLocale(String(preferred).split(',')[0].trim());
  const base = createT(normalized);
  return (key, params = {}) => base(`api.${key}`, params);
}

export async function getLoginSessionTtl(db) {
  const raw = await db.getSetting('LOGIN_SESSION_TTL');
  return Math.max(300, parseInt(raw || '86400', 10) || 86400);
}

export function clampPageSize(value, fallback = 20, max = 200) {
  const parsed = parseInt(value || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function parseAdminIds(str) {
  return (str || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
}

export function cookie(token, maxAge = 86400, { secure = false } = {}) {
  const securePart = secure ? '; Secure' : '';
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${securePart}`;
}

export function isSecureRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.protocol === 'https:') return true;
  } catch { /* noop */ }
  const proto = request.headers.get('x-forwarded-proto') || request.headers.get('cf-visitor') || '';
  if (String(proto).toLowerCase().includes('https')) return true;
  try {
    if (typeof process !== 'undefined' && process?.env?.COOKIE_SECURE) {
      const val = String(process.env.COOKIE_SECURE).trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(val)) {
        return true;
      }
    }
  } catch { /* noop */ }
  return false;
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
