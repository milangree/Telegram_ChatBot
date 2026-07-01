// server/bindings/d1.js
// Cloudflare D1 兼容层 — 使用 better-sqlite3 实现 D1 的 prepare/first/all/run API
// 让现有 CF Functions 代码（KVStore/D1Store）无需修改即可运行

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.resolve(process.env.D1_FILE || './data/d1-store.db')

export class LocalD1 {
  constructor() {
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this._db = new Database(DB_PATH)
    this._db.pragma('journal_mode = WAL')
    this._db.pragma('foreign_keys = ON')
    console.log(`[D1] 数据库路径: ${DB_PATH}`)
  }

  /**
   * 实现 Cloudflare D1 的 prepare() 接口
   * 返回的对象支持 .bind().first() / .bind().all() / .bind().run()
   */
  prepare(sql) {
    const self = this
    let boundParams = null

    const stmt = {
      bind(...params) {
        boundParams = params
        return stmt
      },
      async first(colName) {
        try {
          const row = self._db.prepare(sql).get(...(boundParams || []))
          if (!row) return null
          if (colName && Object.hasOwn(row, colName)) return row[colName]
          return row
        } catch (e) {
          console.error('[D1 first]', sql, e.message)
          throw e
        }
      },
      async all() {
        try {
          const results = self._db.prepare(sql).all(...(boundParams || []))
          return { results, success: true }
        } catch (e) {
          console.error('[D1 all]', sql, e.message)
          throw e
        }
      },
      async run() {
        try {
          const info = self._db.prepare(sql).run(...(boundParams || []))
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
            },
          }
        } catch (e) {
          console.error('[D1 run]', sql, e.message)
          throw e
        }
      },
    }
    return stmt
  }

  /**
   * 批量执行（D1 的 batch 接口）
   */
  async batch(statements) {
    const results = []
    for (const s of statements) {
      if (typeof s === 'string') {
        this._db.exec(s)
        results.push({ success: true })
      } else {
        const result = await s.run()
        results.push(result)
      }
    }
    return results
  }

  /**
   * 直接 exec — 对应 D1 的 exec 接口
   */
  exec(sql) {
    this._db.exec(sql)
    return { success: true }
  }

  close() {
    if (this._db) this._db.close()
  }
}
