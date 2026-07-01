// server/bindings/kv.js
// Cloudflare KV 兼容层 — 内存存储 + SQLite 持久化
// 实现了 CF Workers KV 的 get/put/delete/list API

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.resolve(process.env.KV_FILE || './data/kv-store.db')

export class LocalKV {
  constructor() {
    this._db = null
    this._mem = new Map()
    this._persist = process.env.KV_PERSIST !== 'false'
    this._init()
  }

  _init() {
    if (!this._persist) return
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this._db = new Database(DB_PATH)
    this._db.pragma('journal_mode = WAL')
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
  }

  async get(key, options = {}) {
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
    this._mem.delete(key)
    if (this._persist && this._db) {
      this._db.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
    }
  }

  async list(options = {}) {
    const prefix = options.prefix || ''
    const limit = options.limit || Infinity
    const keys = []

    for (const [key, entry] of this._mem) {
      if (!key.startsWith(prefix)) continue
      if (entry.exp && entry.exp <= Date.now()) {
        this._mem.delete(key)
        continue
      }
      keys.push({ name: key })
      if (keys.length >= limit) break
    }

    keys.sort((a, b) => a.name.localeCompare(b.name))

    return {
      keys,
      list_complete: keys.length < this._mem.size,
      cursor: null,
    }
  }

  async getWithMetadata(key) {
    const entry = this._mem.get(key)
    if (!entry) return null
    if (entry.exp && entry.exp <= Date.now()) {
      this._mem.delete(key)
      return null
    }
    return { value: entry.value, metadata: { expiration: entry.exp } }
  }

  close() {
    if (this._db) this._db.close()
    this._mem.clear()
  }
}
