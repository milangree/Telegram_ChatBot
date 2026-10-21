// server/bindings/kv.js
// Cloudflare KV 兼容层 — 内存存储 + 可选 SQLite 持久化（支持加密）
// 实现了 CF Workers KV 的 get/put/delete/list API
// better-sqlite3 不可用或 KV_PERSIST=false 时自动降级为纯内存模式

import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { webcrypto } from 'crypto'

const require = createRequire(import.meta.url)
const DB_PATH = path.resolve(process.env.KV_FILE || './data/kv-store.db')

function tryLoadBetterSqlite3() {
  try {
    // 优先使用支持加密的版本
    return require('better-sqlite3-multiple-ciphers')
  } catch {
    try {
      return require('better-sqlite3')
    } catch (err) {
      return { error: err }
    }
  }
}

async function generateEncryptionKey() {
  const key = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
  const exported = await webcrypto.subtle.exportKey('raw', key)
  return Buffer.from(exported).toString('base64')
}

async function getEncryptionKey() {
  const envKey = process.env.KV_ENCRYPTION_KEY
  if (envKey) return envKey

  // 尝试从文件读取
  const keyPath = path.join(path.dirname(DB_PATH), '.kv-key')
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8').trim()
  }

  // 生成新密钥
  const newKey = await generateEncryptionKey()
  fs.writeFileSync(keyPath, newKey, { mode: 0o600 })
  console.warn('[KV] 已生成新的加密密钥，请妥善保管 .kv-key 文件')
  return newKey
}

export class LocalKV {
  constructor() {
    this._db = null
    this._mem = new Map()
    this._persist = process.env.KV_PERSIST !== 'false'
    this._cleanupInterval = null
    this._readyPromise = this._init()
  }

  async _ensureReady() {
    await this._readyPromise
  }

  _fallbackMemory(reason) {
    this._persist = false
    this._db = null
    console.warn(`[KV] 已降级为纯内存模式: ${reason}`)
  }

  async _init() {
    if (!this._persist) {
      console.log('[KV] 纯内存模式（KV_PERSIST=false）')
      return
    }

    const loaded = tryLoadBetterSqlite3()
    if (loaded?.error || typeof loaded !== 'function') {
      this._fallbackMemory(loaded?.error?.message || 'better-sqlite3 未安装')
      return
    }

    try {
      const Database = loaded
      const dir = path.dirname(DB_PATH)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      // 检查数据库是否已存在（用于判断是否需要加密）
      const dbExists = fs.existsSync(DB_PATH)

      this._db = new Database(DB_PATH)
      this._db.pragma('journal_mode = WAL')

      // 启用加密（如果配置了密钥）
      const encryptionKey = process.env.KV_ENCRYPTION_KEY || await getEncryptionKey().catch(() => null)
      if (encryptionKey) {
        this._db.pragma(`key = '${encryptionKey}'`)
        // 验证密钥是否正确（对已存在的数据库）
        if (dbExists) {
          try {
            this._db.pragma('schema_version')
          } catch (e) {
            this._fallbackMemory('数据库加密密钥不匹配')
            return
          }
        }
        console.log('[KV] 数据库加密已启用')
      }

      this._db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          exp   INTEGER DEFAULT NULL
        )
      `)
      // 清理过期条目
      this._db.prepare('DELETE FROM kv_store WHERE exp IS NOT NULL AND exp <= ?').run(Date.now())

      // 加载已有数据到内存
      const rows = this._db.prepare('SELECT key, value, exp FROM kv_store').all()
      for (const row of rows) {
        if (row.exp && row.exp <= Date.now()) continue
        this._mem.set(row.key, { value: row.value, exp: row.exp || null })
      }
      console.log(`[KV] 已加载 ${this._mem.size} 个键值对`)

      // 定期清理过期键（每 5 分钟）
      this._cleanupInterval = setInterval(() => this._cleanupExpired(), 5 * 60 * 1000)
      if (this._cleanupInterval.unref) this._cleanupInterval.unref() // 不阻止进程退出
    } catch (err) {
      this._fallbackMemory(err.message || String(err))
    }
  }

  _cleanupExpired() {
    const now = Date.now()
    let cleaned = 0
    for (const [key, entry] of this._mem) {
      if (entry.exp && entry.exp <= now) {
        this._mem.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0 && this._persist && this._db) {
      this._db.prepare('DELETE FROM kv_store WHERE exp IS NOT NULL AND exp <= ?').run(now)
    }
    if (cleaned > 0) console.log(`[KV] 清理了 ${cleaned} 个过期键`)
  }

  async get(key, options = {}) {
    await this._ensureReady()
    const entry = this._mem.get(key)
    if (!entry) return null
    if (entry.exp && entry.exp <= Date.now()) {
      this._mem.delete(key)
      return null
    }
    const val = entry.value
    if (options.type === 'json') {
      try { return JSON.parse(val) } catch { return null }
    }
    return val
  }

  async put(key, value, options = {}) {
    await this._ensureReady()
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value)
    let exp = null
    if (options.expirationTtl) {
      exp = Date.now() + options.expirationTtl * 1000
    } else if (options.expiration) {
      exp = options.expiration * 1000
    }
    this._mem.set(key, { value: strVal, exp })

    if (this._persist && this._db) {
      this._db.prepare(
        'INSERT OR REPLACE INTO kv_store(key, value, exp) VALUES(?, ?, ?)',
      ).run(key, strVal, exp)
    }
  }

  async delete(key) {
    await this._ensureReady()
    this._mem.delete(key)
    if (this._persist && this._db) {
      this._db.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
    }
  }

  async list(options = {}) {
    await this._ensureReady()
    const prefix = options.prefix || ''
    const limit = options.limit || Infinity
    const cursorToken = options.cursor || ''
    const names = []

    for (const [key, entry] of this._mem) {
      if (!key.startsWith(prefix)) continue
      if (entry.exp && entry.exp <= Date.now()) {
        this._mem.delete(key)
        continue
      }
      names.push(key)
    }

    names.sort((a, b) => a.localeCompare(b))
    const start = cursorToken ? Math.max(0, names.indexOf(cursorToken) + 1) : 0
    const pageNames = names.slice(start, start + limit)
    const hasMore = start + pageNames.length < names.length

    return {
      keys: pageNames.map(name => ({ name })),
      list_complete: !hasMore,
      cursor: hasMore ? pageNames[pageNames.length - 1] : null,
    }
  }

  async getWithMetadata(key) {
    await this._ensureReady()
    const entry = this._mem.get(key)
    if (!entry) return null
    if (entry.exp && entry.exp <= Date.now()) {
      this._mem.delete(key)
      return null
    }
    return { value: entry.value, metadata: { expiration: entry.exp } }
  }

  close() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }
    if (this._db) {
      try {
        // WAL 下先 checkpoint，减少 close 阻塞
        try { this._db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* noop */ }
        this._db.close()
      } catch (e) {
        console.warn('[KV] close 失败:', e?.message || e)
      }
      this._db = null
    }
    this._mem.clear()
  }
}
