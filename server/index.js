// server/index.js
// Express HTTP 服务器 — 桥接层
// 将 HTTP 请求转换为 Cloudflare Workers 格式，调用现有 functions/ 中的代码
// 支持 KV、D1、Hyperdrive 三种存储后端

import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { LocalKV } from './bindings/kv.js'
import { corsHeadersFor, checkRequestOrigin } from '../functions/_shared/cors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = parseInt(process.env.PORT || '3000', 10)
// Docker / 容器部署默认监听所有网卡；本地日志展示用 localhost，避免浏览器打不开 0.0.0.0
const HOST = process.env.HOST || '0.0.0.0'
const DISPLAY_HOST = process.env.DISPLAY_HOST
  || (HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST)
const PID_FILE = path.join(ROOT, '.server.pid')
// Docker / 生产环境不提示本地停止命令；仅本地开发显示
const IS_LOCAL_DEV = process.env.NODE_ENV !== 'production'
  && !process.env.DOCKER
  && !fs.existsSync('/.dockerenv')

// ── 全局 polyfill ─────────────────────────────────────────────────────────
// Cloudflare Workers 全局可用，Node.js 也需要
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = await import('crypto')
  globalThis.crypto = webcrypto
}

// ── 存储绑定初始化 ─────────────────────────────────────────────────────────
console.log('[server] 正在初始化存储绑定...')

const kv = new LocalKV()
const d1File = process.env.D1_FILE
const hyperdriveConnStr = process.env.DATABASE_URL

// D1 绑定（需要 better-sqlite3；不可用时自动跳过）
let d1 = null
if (d1File || process.env.ACTIVE_DB === 'd1') {
  try {
    const { LocalD1 } = await import('./bindings/d1.js')
    d1 = new LocalD1()
  } catch (e) {
    console.warn('[server] D1 初始化失败，已跳过:', e.message)
    d1 = null
  }
}

// Hyperdrive 绑定（如果配置了 DATABASE_URL）
let hyperdrive = null
if (hyperdriveConnStr) {
  try {
    // 动态导入 HyperdriveStore，可能需要 pg 或 mysql2
    const { HyperdriveStore } = await import('../functions/_shared/db-hyperdrive.js')
    // HyperdriveStore 构造函数需要 { connectionString } 对象（模拟 CF Hyperdrive 绑定）
    hyperdrive = new HyperdriveStore({ connectionString: hyperdriveConnStr })
    console.log(`[server] Hyperdrive 已连接: ${hyperdriveConnStr.replace(/:[^:]*@/, ':***@')}`)
  } catch (e) {
    console.warn('[server] Hyperdrive 初始化失败:', e.message)
  }
}

// 动态导入现有 Cloudflare Functions
const { onRequest: apiHandler } = await import('../functions/api/[[path]].js')
const { onRequestPost: webhookHandler } = await import('../functions/webhook.js')

console.log('[server] Functions 已加载')

// ── 启动初始化 ─────────────────────────────────────────────────────────────
// 在 app.listen 前执行一次管理员初始化，确保：
// 1) KV/D1/Hyperdrive 可用
// 2) 初始管理员账号已创建或同步
// 3) 初始化失败时进程不监听端口，避免半初始化状态
console.log('[server] 执行启动初始化...')
{
  const { DB } = await import('../functions/_shared/db.js')
  const { ensureAdminInitializedOnce } = await import('../functions/_shared/admin-bootstrap.js')
  const startupDb = new DB(kv, d1, hyperdrive)
  const preferredDb = process.env.ACTIVE_DB === 'd1' && d1
    ? 'd1'
    : process.env.ACTIVE_DB === 'hyperdrive' && hyperdrive
      ? 'hyperdrive'
      : process.env.ACTIVE_DB === 'kv'
        ? 'kv'
        : null
  await startupDb.autoRepair(false, preferredDb)
  await ensureAdminInitializedOnce({ db: startupDb, kv, env: process.env })
  console.log('[server] 管理员初始化完成')
}

// ── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 将 Express 请求转换为 Cloudflare Workers Request 对象
 */
function expressToCfRequest(req, fullUrl) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
  }

  // 防伪造：剥离客户端自带的转发头，只保留服务端自己观测到的对端地址。
  // 未启用 TRUST_PROXY 时，外部提供的 XFF / X-Real-IP 一律不可信。
  headers.delete('x-forwarded-for')
  headers.delete('x-real-ip')
  headers.delete('x-tgcb-peer-ip')
  const peerIp = req.socket?.remoteAddress || ''
  if (peerIp) {
    headers.set('x-tgcb-peer-ip', String(peerIp).replace(/^::ffff:/, ''))
    process.env.TGCB_TRUST_LOCAL_IP = '1'
  }

  const init = {
    method: req.method,
    headers,
  }

  // 对于有 body 的请求，传递原始 body
  // Buffer 必须原样透传：JSON.stringify(Buffer) 会变成 {"type":"Buffer","data":[...]}，
  // 破坏 multipart 边界与二进制内容。
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      init.body = req.body
    } else if (typeof req.body === 'string') {
      init.body = req.body
    } else if (req.body instanceof Uint8Array) {
      init.body = req.body
    } else {
      init.body = JSON.stringify(req.body)
    }
  }

  return new Request(fullUrl, init)
}

/**
 * 将 Cloudflare Workers Response 转换为 Express 响应
 */
async function cfResponseToExpress(cfRes, res) {
  // 设置状态码
  res.status(cfRes.status)

  // 设置 headers
  cfRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      // Set-Cookie 可能包含多个值
      const cookies = value.split(/,(?=\s*\w+=)/)
      cookies.forEach(c => res.append('Set-Cookie', c.trim()))
    } else {
      res.set(key, value)
    }
  })

  // 流式传输 body
  if (cfRes.body) {
    const reader = cfRes.body.getReader()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const fullBody = Buffer.concat(chunks.map(c => Buffer.from(c)))
    res.send(fullBody)
  } else {
    res.end()
  }
}

/**
 * 模拟 Cloudflare 的 waitUntil — fire-and-forget
 */
function waitUntil(promise) {
  promise.catch(e => console.error('[waitUntil]', e))
}

/**
 * 构建 Cloudflare 兼容的 context 对象
 */
function buildContext(request) {
  return {
    request,
    env: {
      KV: kv,
      D1: d1,
      HYPERDRIVE: hyperdrive,
    },
    waitUntil,
    passThroughOnException() {},
  }
}

// ── Express 应用 ──────────────────────────────────────────────────────────

const app = express()

// 禁用 Express 版本标识，防止信息泄露
app.disable('x-powered-by')

// 请求体上限：必须早于任何 body 解析器，否则声明大 Content-Length 的请求
// 会被解析器拖着读流（挂住连接），而不是立刻拒绝。
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024
app.use((req, res, next) => {
  const len = Number(req.headers['content-length'] || 0)
  if (Number.isFinite(len) && len > MAX_REQUEST_BODY_BYTES) {
    return res.status(413).json({ error: '文件过大（上限 20MB）' })
  }
  next()
})

// 解析 JSON body（用于 API 请求）
app.use(express.json({ limit: '10mb' }))

// 非 JSON 请求体（multipart / 二进制）：保留原始字节，供 Functions 按原样解析。
// 之前只装了 express.json，multipart 的 req.body 为空，桥接层传不出 body，
// 导致 /api/conversations/:id 的文件上传在本地部署必然失败。
app.use(express.raw({ type: () => true, limit: '32mb' }))

// CORS 中间件：复用 functions/_shared/cors.js 的单一策略（默认同源，白名单可选）
app.use((req, res, next) => {
  // 构造一个最小的 Headers 视图供统一策略计算，避免两套逻辑漂移
  const probe = new Request(`http://${req.get('host') || 'localhost'}${req.originalUrl || req.url}`, {
    method: req.method,
    headers: new Headers(req.headers),
  })
  for (const [key, value] of Object.entries(corsHeadersFor(probe, process.env))) {
    res.set(key, value)
  }
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

// 反向代理信任：仅当 TRUST_PROXY=1 时采信 X-Forwarded-*（影响 req.ip / req.protocol）
if (['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_PROXY || '').toLowerCase())) {
  app.set('trust proxy', 1)
}

// 状态变更请求的跨站来源校验（与 API 入口同一策略）
app.use((req, res, next) => {
  const probe = new Request(`http://${req.get('host') || 'localhost'}${req.originalUrl || req.url}`, {
    method: req.method,
    headers: new Headers(req.headers),
  })
  const result = checkRequestOrigin(probe, process.env)
  if (!result.ok) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
})

// Content-Security-Policy 中间件 — 仅对 HTML 页面生效
app.use((req, res, next) => {
  // 仅对非 API 路径的 HTML 响应添加 CSP（API 响应由 API handler 自行处理）
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/webhook')) {
    res.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  }
  next()
})

// 独立健康检查路由（解耦业务自举与重试锁，专供 Docker / K8s 存活与就绪探测）
app.get('/healthz', async (_req, res) => {
  try {
    // 检查 KV
    if (kv && typeof kv.get === 'function') {
      await kv.get('__health_probe__')
    }
    // 检查活动 DB
    const { DB } = await import('../functions/_shared/db.js')
    const probeDb = new DB(kv, d1, hyperdrive)
    // DB 暴露的是 getActiveDb()（历史代码曾误用不存在的 getActiveBackend，导致健康检查恒为 503）
    const activeBackend = await probeDb.getActiveDb().catch(() => null)
    if (!activeBackend) {
      return res.status(503).json({ status: 'unhealthy', error: 'No active DB backend available' })
    }
    res.status(200).json({ status: 'healthy', activeDb: activeBackend })
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err?.message || String(err) })
  }
})

// body 解析失败（超限/格式错误）统一返回 JSON，避免 Express 默认 HTML 错误页
app.use((err, req, res, next) => {
  if (!err) return next()
  const status = err.status || err.statusCode || 500
  if (status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({ error: '文件过大（上限 20MB）' })
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体格式错误' })
  }
  console.error('[body-parser]', err?.message || err)
  res.status(status).json({ error: '请求处理失败' })
})

// Webhook 路由 — Telegram Bot 调用
app.all('/webhook', async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
    const cfReq = expressToCfRequest(req, fullUrl)
    const ctx = buildContext(cfReq)
    const cfRes = await webhookHandler(ctx)
    await cfResponseToExpress(cfRes, res)
  } catch (e) {
    console.error('[webhook error]', e)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// API 路由 — 所有 /api/* 请求
app.all('/api/{*path}', async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
    const cfReq = expressToCfRequest(req, fullUrl)
    const ctx = buildContext(cfReq)
    const cfRes = await apiHandler(ctx)
    await cfResponseToExpress(cfRes, res)
  } catch (e) {
    console.error('[api error]', e)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 静态文件 — 前端构建产物
const distDir = path.join(ROOT, 'dist')
if (fs.existsSync(distDir)) {
  // 分层缓存：HTML 入口每次都向服务器验证（no-cache），
  // 带内容哈希的静态资源（app-XXXX.js/css）长期缓存（1 年）。
  // 这样重新部署后，用户下一次打开就能拿到新版入口，
  // 而未被改动的哈希资源仍走本地缓存，不影响加载速度。
  app.use(express.static(distDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        // no-store：彻底不让任何层（浏览器/CDN/WebView）缓存 HTML 入口
        res.setHeader('Cache-Control', 'no-store, max-age=0')
      } else if (/(?:^|[-_])[0-9a-zA-Z]{6,}\.[a-z0-9]+(?:\?.*)?$/.test(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }
    },
  }))

  // Swagger UI — API 文档
  app.get('/api-docs', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Telegram ChatBot API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/openapi.yaml', dom_id: '#swagger-ui' })
  </script>
</body>
</html>`)
  })

  app.get('/openapi.yaml', (_req, res) => {
    const openapiPath = path.join(ROOT, 'openapi.yaml')
    if (fs.existsSync(openapiPath)) {
      res.setHeader('Content-Type', 'text/yaml')
      res.sendFile(openapiPath)
    } else {
      res.status(404).send('OpenAPI spec not found')
    }
  })

  // SPA 回退 — 对已知探测路径返回 404 而非 SPA 页面，避免掩盖真实端点
  const PROBE_PATTERNS = [
    '/admin', '/administrator', '/wp-admin', '/wp-login', '/wp-content',
    '/config', '/configuration', '/settings',
    '/package.json', '/composer.json', '/yarn.lock', '/package-lock.json',
    '/.env', '/.git', '/.gitignore', '/.dockerignore', '/.env.example',
    '/server-status', '/server-info',
    '/xmlrpc', '/xmlrpc.php', '/wp-includes',
    '/actuator', '/actuator/health', '/actuator/info',
    '/swagger', '/swagger-ui', '/swagger-resources', '/api-docs', '/openapi.json', '/v2/api-docs', '/v3/api-docs',
    '/backup', '/dump', '/db', '/database',
    '/robots.txt', '/sitemap.xml', '/crossdomain.xml', '/clientaccesspolicy.xml',
    '/shell', '/cmd', '/exec', '/upload', '/uploads',
    '/phpinfo', '/phpinfo.php', '/info.php', '/test.php',
    '/cgi-bin', '/cgi-bin/',
    '/.htaccess', '/.htpasswd',
    '/proxy', '/proxy/',
    '/owa', '/exchange', '/autodiscover',
    '/vendor', '/node_modules',
    '/tmp', '/temp', '/logs', '/log',
    '/debug', '/dev', '/devtools',
    '/console', '/management',
    '/batch', '/batch/',
    '/web-console', '/jmx',
    '/grafana', '/prometheus', '/metrics',
    '/jenkins', '/jenkins/',
    '/.well-known/security.txt',
  ]

  // 检查路径是否为已知探测路径（不区分大小写）
  function isProbePath(pathname) {
    const lower = pathname.toLowerCase()
    // 精确匹配或路径前缀匹配
    return PROBE_PATTERNS.some(pattern => {
      if (pattern.endsWith('/')) return lower === pattern.slice(0, -1) || lower.startsWith(pattern)
      return lower === pattern || lower.startsWith(pattern + '/') || lower.startsWith(pattern + '.')
    })
  }

  const indexPath = path.join(distDir, 'index.html')

  app.get('{*path}', (req, res) => {
    // 对探测路径返回 404
    if (isProbePath(req.path)) {
      return res.status(404).send('Not Found')
    }
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      res.status(404).send('Frontend not built. Run: npm run build')
    }
  })

  console.log(`[server] 静态文件目录: ${distDir}`)
} else {
  console.warn('[server] dist/ 目录不存在，请先运行 npm run build')
  app.get('{*path}', (req, res) => {
    res.status(503).send('Frontend not built. Run: npm run build first.')
  })
}

// ── 启动服务器 ────────────────────────────────────────────────────────────

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8')
  } catch (e) {
    console.warn('[server] 写入 PID 文件失败:', e.message)
  }
}

function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const existing = fs.readFileSync(PID_FILE, 'utf8').trim()
      // 只删除属于当前进程的 PID 文件，避免误删新实例
      if (!existing || existing === String(process.pid)) fs.unlinkSync(PID_FILE)
    }
  } catch {
    /* noop */
  }
}

let shuttingDown = false
let shutdownFinished = false
// 追踪连接：旧 Node 无 closeAllConnections 时，关闭阶段可主动 destroy
const openSockets = new Set()

const httpServer = app.listen(PORT, HOST, () => {
  writePidFile()
  console.log(`[server] 🚀 服务器已启动: http://${DISPLAY_HOST}:${PORT}`)
  console.log(`[server] 📡 Webhook 地址: http://${DISPLAY_HOST}:${PORT}/webhook`)
  console.log(`[server] 🔧 API 地址: http://${DISPLAY_HOST}:${PORT}/api`)
  console.log(`[server] 💾 存储后端: KV${d1 ? ' + D1' : ''}${hyperdrive ? ' + Hyperdrive' : ''}`)
  if (IS_LOCAL_DEV) {
    console.log(`[server] 🛑 停止服务: Ctrl+C 或 npm run stop`)
  }
})

// 缩短 keep-alive，避免本地浏览器挂起连接拖住 close
httpServer.keepAliveTimeout = 5000
httpServer.headersTimeout = 6000
httpServer.requestTimeout = 30000

httpServer.on('connection', (socket) => {
  openSockets.add(socket)
  socket.on('close', () => openSockets.delete(socket))
})

// ── WebSocket 支持 ──────────────────────────────────────────────────────────
import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
// userId -> Set<WebSocket>：同一账号多标签页/重连不会互相覆盖
const wsClients = new Map()

function addWsClient(userId, ws) {
  const key = String(userId)
  if (!wsClients.has(key)) wsClients.set(key, new Set())
  wsClients.get(key).add(ws)
  return key
}

function removeWsClient(userId, ws) {
  const key = String(userId)
  const set = wsClients.get(key)
  if (!set) return
  set.delete(ws)
  if (!set.size) wsClients.delete(key)
}

/** 周期性复核连接权限，兜住会话过期 / 降权 / 删除。 */
async function revalidateWsClient(userId, ws) {
  try {
    const { DB } = await import('../functions/_shared/db.js')
    const { isWebAdmin } = await import('../functions/_shared/api-utils.js')
    const { isBootstrapAdminDisabled } = await import('../functions/_shared/admin-bootstrap.js')
    const db = new DB(kv, d1, hyperdrive)
    const user = await db.getWebUserById(userId)
    if (!user || !isWebAdmin(user) || await isBootstrapAdminDisabled({ kv, user })) {
      ws.close(4003, 'Forbidden')
    }
  } catch (e) {
    console.error('[WS] 权限复核异常:', e?.message || e)
  }
}

wss.on('connection', async (ws, req) => {
  // 从 cookie 中提取 session token
  const cookie = req.headers.cookie || ''
  const match = cookie.match(/session=([^;]+)/)
  const token = match ? match[1] : null

  if (!token) {
    ws.close(4001, 'Unauthorized')
    return
  }

  let sess
  try {
    const { getSession } = await import('../functions/_shared/auth.js')
    sess = await getSession(kv, token)
  } catch (err) {
    console.error('[WS] 鉴权异常:', err?.message || err)
    ws.close(4001, 'Unauthorized')
    return
  }
  if (!sess || !sess.userId) {
    ws.close(4001, 'Unauthorized')
    return
  }

  // 与 API 入口保持一致的权限校验：用户必须存在且仍是管理员
  try {
    const { DB } = await import('../functions/_shared/db.js')
    const { isWebAdmin } = await import('../functions/_shared/api-utils.js')
    const { isBootstrapAdminDisabled } = await import('../functions/_shared/admin-bootstrap.js')
    const db = new DB(kv, d1, hyperdrive)
    const user = await db.getWebUserById(sess.userId)
    if (!user || !isWebAdmin(user) || await isBootstrapAdminDisabled({ kv, user })) {
      ws.close(4003, 'Forbidden')
      return
    }
  } catch (e) {
    console.error('[WS] 权限校验异常:', e?.message || e)
    ws.close(4001, 'Unauthorized')
    return
  }

  const userId = sess.userId
  const clientKey = addWsClient(userId, ws)
  console.log(`[WS] 客户端鉴权成功已连接: user=${userId} conns=${wsClients.get(clientKey).size}`)

  // 每 5 分钟复核一次权限（会话过期 / 降权即时断开）
  const revalidateTimer = setInterval(() => {
    if (ws.readyState !== 1) return
    revalidateWsClient(userId, ws)
  }, 5 * 60 * 1000)
  if (revalidateTimer.unref) revalidateTimer.unref()

  ws.on('close', () => {
    clearInterval(revalidateTimer)
    removeWsClient(userId, ws)
    console.log(`[WS] 客户端已断开: user=${userId}`)
  })

  ws.on('error', (err) => {
    clearInterval(revalidateTimer)
    removeWsClient(userId, ws)
    console.error(`[WS] 客户端错误: ${err.message}`)
  })

  // 发送连接成功消息
  ws.send(JSON.stringify({ type: 'connected' }))
})

// 广播消息给所有已连接的客户端
function broadcastWsMessage(message) {
  const data = JSON.stringify(message)
  for (const set of wsClients.values()) {
    for (const ws of set) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(data)
      }
    }
  }
}

console.log(`[server] 🔌 WebSocket 地址: ws://${DISPLAY_HOST}:${PORT}/ws`)

function destroyOpenSockets() {
  for (const socket of openSockets) {
    try {
      socket.destroy()
    } catch { /* noop */ }
  }
  openSockets.clear()
}

function dropConnections() {
  try {
    if (typeof httpServer.closeIdleConnections === 'function') {
      httpServer.closeIdleConnections()
    }
  } catch { /* noop */ }
  try {
    if (typeof httpServer.closeAllConnections === 'function') {
      httpServer.closeAllConnections()
    } else {
      destroyOpenSockets()
    }
  } catch {
    destroyOpenSockets()
  }
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，正在关闭...`)

  const forceTimer = setTimeout(() => {
    if (shutdownFinished) return
    console.warn('[server] 关闭超时，强制退出')
    try { dropConnections() } catch { /* noop */ }
    removePidFile()
    process.exit(1)
  }, 3000)
  if (forceTimer.unref) forceTimer.unref()

  // 先断开 keep-alive / 挂起连接，避免 httpServer.close 一直等待
  dropConnections()

  const finish = async (err) => {
    if (shutdownFinished) return
    shutdownFinished = true
    if (err) console.warn('[server] httpServer.close:', err.message || err)
    try {
      if (typeof kv?.close === 'function') kv.close()
      if (d1 && typeof d1.close === 'function') d1.close()
      if (hyperdrive && typeof hyperdrive.close === 'function') {
        await Promise.race([
          hyperdrive.close().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ])
      }
    } catch (e) {
      console.warn('[server] 释放存储资源失败:', e?.message || e)
    } finally {
      clearTimeout(forceTimer)
      removePidFile()
      console.log('[server] 已停止')
      process.exit(0)
    }
  }

  try {
    httpServer.close((err) => {
      finish(err)
    })
    // 再断一次连接，确保 close 回调能触发
    const retry = setTimeout(() => {
      dropConnections()
    }, 200)
    if (retry.unref) retry.unref()
  } catch (e) {
    finish(e)
  }
}

// 优雅退出
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
// Windows Ctrl+C / 关闭控制台：额外兼容
if (process.platform === 'win32') {
  try {
    process.on('SIGBREAK', () => shutdown('SIGBREAK'))
  } catch { /* noop */ }
}
process.on('exit', removePidFile)
