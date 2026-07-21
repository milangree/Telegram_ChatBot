// server/index.js
// Express HTTP 服务器 — 桥接层
// 将 HTTP 请求转换为 Cloudflare Workers 格式，调用现有 functions/ 中的代码
// 支持 KV、D1、Hyperdrive 三种存储后端

import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { LocalKV } from './bindings/kv.js'

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

  const init = {
    method: req.method,
    headers,
  }

  // 对于有 body 的请求，传递原始 body
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
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

// 解析 JSON body（用于 API 请求）
app.use(express.json({ limit: '10mb' }))

// CORS 中间件：默认同源（不设 *）；可通过 CORS_ORIGIN 指定白名单
app.use((req, res, next) => {
  const raw = process.env.CORS_ORIGIN || ''
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const reqOrigin = req.get('Origin')
  if (allowed.length === 1 && allowed[0] !== '*') {
    res.set('Access-Control-Allow-Origin', allowed[0])
  } else if (allowed.length > 1 && reqOrigin && allowed.includes(reqOrigin)) {
    res.set('Access-Control-Allow-Origin', reqOrigin)
    res.set('Vary', 'Origin')
  }
  // 未配置 CORS_ORIGIN 时不返回 Allow-Origin（浏览器跨站读会被拦；同域 Cookie 会话不受影响）
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Locale')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
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
  app.use(express.static(distDir))

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
