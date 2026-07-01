// server/index.js
// Express HTTP 服务器 — 桥接层
// 将 HTTP 请求转换为 Cloudflare Workers 格式，调用现有 functions/ 中的代码
// 支持 KV、D1、Hyperdrive 三种存储后端

import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { LocalKV } from './bindings/kv.js'
import { LocalD1 } from './bindings/d1.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = parseInt(process.env.PORT || '3000', 10)

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

// D1 绑定（如果配置了 D1_FILE 环境变量，默认启用）
let d1 = null
if (d1File || process.env.ACTIVE_DB === 'd1') {
  d1 = new LocalD1()
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

// CORS 中间件
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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
app.all('/api/*', async (req, res) => {
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

  // SPA 回退 — 所有非文件请求返回 index.html
  app.get('*', (req, res) => {
    const indexPath = path.join(distDir, 'index.html')
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      res.status(404).send('Frontend not built. Run: npm run build')
    }
  })

  console.log(`[server] 静态文件目录: ${distDir}`)
} else {
  console.warn('[server] dist/ 目录不存在，请先运行 npm run build')
  app.get('*', (req, res) => {
    res.status(503).send('Frontend not built. Run: npm run build first.')
  })
}

// ── 启动服务器 ────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] 🚀 服务器已启动: http://0.0.0.0:${PORT}`)
  console.log(`[server] 📡 Webhook 地址: http://0.0.0.0:${PORT}/webhook`)
  console.log(`[server] 🔧 API 地址: http://0.0.0.0:${PORT}/api`)
  console.log(`[server] 💾 存储后端: KV${d1 ? ' + D1' : ''}${hyperdrive ? ' + Hyperdrive' : ''}`)
})

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[server] 收到 SIGTERM，正在关闭...')
  kv.close()
  if (d1) d1.close()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[server] 收到 SIGINT，正在关闭...')
  kv.close()
  if (d1) d1.close()
  process.exit(0)
})
