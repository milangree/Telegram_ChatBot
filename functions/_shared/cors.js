// functions/_shared/cors.js
// 统一 CORS 策略（全项目唯一实现）
//
// 规则：
// - 默认同源：不回 Access-Control-Allow-Origin，浏览器跨站无法读取响应。
// - 配置 CORS_ORIGIN（逗号分隔）后，仅当请求 Origin 命中白名单才回写该 Origin。
// - 永不回写 '*'（与 Cookie 凭据 / Bearer 并存时不安全）。
// - 未命中白名单时仍返回 Vary: Origin，避免共享缓存串味。

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Locale';

/** 读取白名单配置：优先 env 绑定（Workers），其次 process.env（Node）。 */
export function parseAllowedOrigins(env = {}) {
  const raw = env?.CORS_ORIGIN
    ?? (typeof process !== 'undefined' ? process?.env?.CORS_ORIGIN : '')
    ?? '';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '*');
}

/** 归一化 Origin：去尾部斜杠、转小写，仅用于比较。 */
function normalizeOrigin(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    return new URL(s).origin.toLowerCase();
  } catch {
    return s.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * 计算本请求应返回的 CORS 头。
 * @param {Request} request
 * @param {object} env 环境绑定（可含 CORS_ORIGIN）
 */
export function corsHeadersFor(request, env = {}) {
  const allowed = parseAllowedOrigins(env).map(normalizeOrigin).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Vary': 'Origin',
  };
  if (!allowed.length) return headers;

  const requestOrigin = normalizeOrigin(request?.headers?.get?.('Origin'));
  if (requestOrigin && allowed.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

/**
 * 判断请求来源是否可信（用于状态变更请求的 CSRF 防护）。
 * - GET/HEAD 不校验。
 * - 浏览器发起的跨站写请求必带 Origin；Origin 不在白名单则拒绝。
 * - 无 Origin 且无 Referer 视为非浏览器客户端（curl / 服务端调用），放行。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkRequestOrigin(request, env = {}) {
  const method = String(request?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { ok: true };

  const headers = request?.headers;
  const origin = headers?.get?.('Origin');
  const referer = headers?.get?.('Referer');
  if (!origin && !referer) return { ok: true };

  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return { ok: false, reason: 'bad_request_url' };
  }

  const selfOrigin = normalizeOrigin(requestUrl.origin);
  const allowed = parseAllowedOrigins(env).map(normalizeOrigin).filter(Boolean);

  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (normalized === selfOrigin || allowed.includes(normalized)) return { ok: true };
    return { ok: false, reason: 'origin_not_allowed' };
  }

  // 仅 Referer 的情况：取其 origin 比较
  try {
    const refOrigin = normalizeOrigin(new URL(referer).origin);
    if (refOrigin === selfOrigin || allowed.includes(refOrigin)) return { ok: true };
  } catch { /* noop */ }
  return { ok: false, reason: 'referer_not_allowed' };
}

/** 把 CORS 头写入已有 Response（保留原状态码与 body）。 */
export function applyCorsToResponse(response, request, env = {}) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeadersFor(request, env))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
