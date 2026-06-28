// functions/_shared/db-hyperdrive.js
// HyperdriveStore — 支持 PostgreSQL（pg）和 MySQL（mysql2）的 Cloudflare Hyperdrive 存储层
//
// 使用前提：
// 1. 在 Cloudflare Dashboard 创建 Hyperdrive 绑定，名称必须为 HYPERDRIVE
// 2. 在 wrangler.toml 或 Pages Functions 的兼容性标志中启用 nodejs_compat
// 3. 添加依赖：npm install pg mysql2
//
// Pages Functions 配置示例（在项目设置中配置兼容性标志）:
//   compatibility_flags = [ "nodejs_compat" ]
// 或通过 Cloudflare Dashboard → 项目 → 设置 → 兼容性标志 添加

import { DEFAULT_SETTINGS } from './db-settings.js'
import { kvListAll } from './db-kv.js'

const MAX_STORED_MESSAGE_LENGTH = 1200

function compactMessageContent(content) {
  const raw = typeof content === 'string' ? content : (content == null ? '' : String(content))
  if (raw.length <= MAX_STORED_MESSAGE_LENGTH) return raw
  return raw.slice(0, MAX_STORED_MESSAGE_LENGTH - 1) + '…'
}

// ── 连接字符串检测 ───────────────────────────────────────────────────────────────

function detectDbType(connectionString) {
  if (!connectionString) return null
  if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) return 'postgres'
  if (connectionString.startsWith('mysql://') || connectionString.startsWith('mysql2://')) return 'mysql'
  return null
}

// ── 连接池（模块级单例，跨请求复用） ────────────────────────────────────────────

const pgPools = new Map()
const mysqlPools = new Map()
let pgModule = null
let mysqlModule = null

async function _getPgPool(connectionString, poolOptions = {}) {
  if (pgPools.has(connectionString)) return pgPools.get(connectionString)
  if (!pgModule) {
    try {
      pgModule = await import('pg')
    } catch (e) {
      throw new Error(
        'pg 模块未安装。请运行: npm install pg\n' +
        '同时确保 Cloudflare Pages 已启用 nodejs_compat 兼容性标志。',
      )
    }
  }
  const pool = new pgModule.default.Pool({
    connectionString,
    max: poolOptions.max || 4,
    idleTimeoutMillis: poolOptions.idleTimeout || 30000,
    connectionTimeoutMillis: poolOptions.connectionTimeout || 10000,
    maxUses: poolOptions.maxUses || 100,       // 定期回收连接防止泄漏
    allowExitOnIdle: true,
  })
  pgPools.set(connectionString, pool)
  return pool
}

async function _getMysqlPool(connectionString, poolOptions = {}) {
  if (mysqlPools.has(connectionString)) return mysqlPools.get(connectionString)
  if (!mysqlModule) {
    try {
      mysqlModule = await import('mysql2/promise')
    } catch (e) {
      throw new Error(
        'mysql2 模块未安装。请运行: npm install mysql2\n' +
        '同时确保 Cloudflare Pages 已启用 nodejs_compat 兼容性标志。',
      )
    }
  }
  const pool = mysqlModule.default.createPool({
    uri: connectionString,
    connectionLimit: poolOptions.max || 4,
    idleTimeout: poolOptions.idleTimeout || 30000,
    connectTimeout: poolOptions.connectionTimeout || 10000,
    maxIdle: poolOptions.maxIdle || 2,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  })
  mysqlPools.set(connectionString, pool)
  return pool
}

function _clearPools() {
  for (const pool of pgPools.values()) pool.end().catch(() => {})
  for (const pool of mysqlPools.values()) pool.end().catch(() => {})
  pgPools.clear()
  mysqlPools.clear()
}

// ── DDL Schema ───────────────────────────────────────────────────────────────────
//
// PostgreSQL schema （MySQL schema 见下方）
//
// 如果已有数据库，可以去掉 CREATE TABLE IF NOT EXISTS 部分直接使用；
// 如果是空数据库，此 Schema 将自动创建所需的表。
//
// initSchema() 会在首次使用时自动调用一次。

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  thread_id BIGINT,
  is_verified INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0,
  is_permanent_block INTEGER DEFAULT 0,
  block_reason TEXT,
  blocked_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS thread_map (
  thread_id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  direction TEXT,
  content TEXT,
  message_type TEXT,
  telegram_message_id BIGINT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS recent_convs (
  user_id BIGINT PRIMARY KEY,
  last_message TEXT,
  last_direction TEXT,
  last_at TEXT
);

CREATE TABLE IF NOT EXISTS whitelist (
  user_id BIGINT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS web_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 1,
  created_at TEXT
);
`

const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  \`key\` VARCHAR(255) PRIMARY KEY,
  \`value\` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT PRIMARY KEY,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  language_code VARCHAR(32),
  thread_id BIGINT,
  is_verified TINYINT DEFAULT 0,
  is_blocked TINYINT DEFAULT 0,
  is_permanent_block TINYINT DEFAULT 0,
  block_reason TEXT,
  blocked_by TEXT,
  created_at TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS thread_map (
  thread_id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(255) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  direction VARCHAR(32),
  content LONGTEXT,
  message_type VARCHAR(64),
  telegram_message_id BIGINT,
  created_at TEXT,
  INDEX idx_messages_user (user_id),
  INDEX idx_messages_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recent_convs (
  user_id BIGINT PRIMARY KEY,
  last_message TEXT,
  last_direction VARCHAR(32),
  last_at TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whitelist (
  user_id BIGINT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  created_at TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS web_users (
  id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  totp_secret TEXT,
  totp_enabled TINYINT DEFAULT 0,
  is_admin TINYINT DEFAULT 1,
  created_at TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

// ── HyperdriveStore ──────────────────────────────────────────────────────────────

export class HyperdriveStore {
  /**
   * @param {object} hyperdriveBinding - env.HYPERDRIVE 绑定对象
   * @param {object} [options]
   * @param {number} [options.poolMax] - 连接池最大连接数（默认 4）
   * @param {number} [options.idleTimeout] - 空闲连接超时毫秒数（默认 30000）
   * @param {number} [options.connectionTimeout] - 连接超时毫秒数（默认 10000）
   */
  constructor(hyperdriveBinding, options = {}) {
    if (!hyperdriveBinding || !hyperdriveBinding.connectionString) {
      throw new Error('HyperdriveBinding 无效：缺少 connectionString')
    }
    this._connectionString = hyperdriveBinding.connectionString
    this._dbType = detectDbType(this._connectionString)
    this._options = options
    this._schemaInited = false
    this._pool = null
  }

  get dbType() { return this._dbType }
  get connectionString() { return this._connectionString }

  /** @private 获取连接池 */
  async _getPool() {
    if (this._pool) return this._pool
    if (this._dbType === 'postgres') {
      this._pool = await _getPgPool(this._connectionString, this._options)
    } else if (this._dbType === 'mysql') {
      this._pool = await _getMysqlPool(this._connectionString, this._options)
    } else {
      throw new Error(`不支持的数据库类型: ${this._dbType}。Hyperdrive 连接字符串应以 postgres:// 或 mysql:// 开头。`)
    }
    return this._pool
  }

  /** @private 执行查询（PostgreSQL 风格） */
  async _query(text, params = []) {
    const pool = await this._getPool()
    if (this._dbType === 'postgres') {
      const client = await pool.connect()
      try {
        const res = await client.query(text, params)
        return res
      } finally {
        client.release()
      }
    } else {
      // MySQL — 参数占位符从 $1/$2 转换为 ?
      const mysqlText = text.replace(/\$(\d+)/g, (_, i) => '?')
      const [rows] = await pool.execute(mysqlText, params)
      return { rows, rowCount: rows.length }
    }
  }

  /** @private 执行不返回行的 SQL */
  async _execute(text, params = []) {
    const pool = await this._getPool()
    if (this._dbType === 'postgres') {
      const client = await pool.connect()
      try {
        await client.query(text, params)
      } finally {
        client.release()
      }
    } else {
      const mysqlText = text.replace(/\$(\d+)/g, (_, i) => '?')
      await pool.execute(mysqlText, params)
    }
  }

  /** @private 获取单行 */
  async _first(text, params = []) {
    const res = await this._query(text, params)
    if (this._dbType === 'postgres') {
      return res.rows?.[0] || null
    }
    return res.rows?.[0] || null
  }

  /** @private 获取所有行 */
  async _all(text, params = []) {
    const res = await this._query(text, params)
    if (this._dbType === 'postgres') {
      return res.rows || []
    }
    return res.rows || []
  }

  // ── Schema ─────────────────────────────────────────────────────────────────────

  async initSchema() {
    if (this._schemaInited) return

    if (this._dbType === 'postgres') {
      for (const stmt of PG_SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
        await this._execute(stmt)
      }
    } else if (this._dbType === 'mysql') {
      for (const stmt of MYSQL_SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
        await this._execute(stmt)
      }
    }
    this._schemaInited = true
  }

  // ── Query helpers (D1Store 兼容) ────────────────────────────────────────────────

  async exec(sql, ...params) { return this._execute(sql, params) }
  async first(sql, ...params) { return this._first(sql, params) }
  async all(sql, ...params) { return this._all(sql, params) }

  // ── Settings ────────────────────────────────────────────────────────────────────

  async getSetting(key) {
    const r = await this._first('SELECT value FROM settings WHERE key=$1', [key])
    return r?.value ?? null
  }
  async setSetting(key, value) {
    await this._execute(
      'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      [key, String(value)],
    )
  }
  async getAllSettings() {
    const rows = await this._all('SELECT key,value FROM settings')
    const s = { ...DEFAULT_SETTINGS }
    for (const r of rows) s[r.key] = r.value
    return s
  }

  // ── Users ───────────────────────────────────────────────────────────────────────

  async getUser(userId) { return this._first('SELECT * FROM users WHERE user_id=$1', [userId]) }
  async upsertUser(u) {
    await this._execute(
      `INSERT INTO users(user_id,username,first_name,last_name,language_code,thread_id,is_verified,is_blocked,is_permanent_block,block_reason,blocked_by,created_at)
       VALUES($1,$2,$3,$4,$5,$6,0,0,0,NULL,NULL,$7)
       ON CONFLICT(user_id) DO UPDATE SET
         username=COALESCE(EXCLUDED.username,username),
         first_name=COALESCE(EXCLUDED.first_name,first_name),
         last_name=COALESCE(EXCLUDED.last_name,last_name),
         language_code=COALESCE(EXCLUDED.language_code,language_code)`,
      [u.user_id, u.username || null, u.first_name || null, u.last_name || null,
       u.language_code || null, u.thread_id || null, u.created_at || new Date().toISOString()],
    )
  }
  async setUserThread(userId, threadId) {
    await this._execute('UPDATE users SET thread_id=$1 WHERE user_id=$2', [threadId, userId])
    await this._execute('INSERT INTO thread_map(thread_id,user_id) VALUES($1,$2) ON CONFLICT(thread_id) DO UPDATE SET user_id=EXCLUDED.user_id', [threadId, userId])
  }
  async getUserByThread(threadId) {
    const r = await this._first('SELECT user_id FROM thread_map WHERE thread_id=$1', [threadId])
    return r ? this.getUser(r.user_id) : null
  }
  async setUserVerified(userId, v) {
    await this._execute('UPDATE users SET is_verified=$1 WHERE user_id=$2', [v ? 1 : 0, userId])
  }
  async blockUser(userId, reason, blockedBy, permanent) {
    await this._execute(
      'UPDATE users SET is_blocked=1,is_permanent_block=$1,block_reason=$2,blocked_by=$3 WHERE user_id=$4',
      [permanent ? 1 : 0, reason, blockedBy, userId],
    )
    await this._execute('DELETE FROM whitelist WHERE user_id=$1', [userId])
  }
  async unblockUser(userId) {
    await this._execute('UPDATE users SET is_blocked=0,is_permanent_block=0,block_reason=NULL,blocked_by=NULL WHERE user_id=$1', [userId])
  }
  async updateUsername(userId, newUsername) {
    await this._execute('UPDATE users SET username=$1 WHERE user_id=$2', [newUsername, userId])
  }
  async searchUsers(query, limit = 10) {
    const q = `%${query}%`
    return this._all(
      'SELECT * FROM users WHERE CAST(user_id AS TEXT) LIKE $1 OR username LIKE $1 OR first_name LIKE $1 LIMIT $2',
      [q, limit],
    )
  }
  async getAllUsers(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize
    const [users, countRow] = await Promise.all([
      this._all('SELECT * FROM users WHERE is_verified=1 ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pageSize, offset]),
      this._first('SELECT COUNT(*) as cnt FROM users WHERE is_verified=1'),
    ])
    return { users, total: countRow?.cnt || 0 }
  }
  async getBlockedUsers(page = 1, pageSize = 10) {
    const offset = (page - 1) * pageSize
    const [users, countRow] = await Promise.all([
      this._all('SELECT * FROM users WHERE is_blocked=1 AND is_verified=1 ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pageSize, offset]),
      this._first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=1 AND is_verified=1'),
    ])
    return { users, total: countRow?.cnt || 0 }
  }
  async getNormalUsers(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize
    const [users, countRow] = await Promise.all([
      this._all('SELECT * FROM users WHERE is_blocked=0 AND is_verified=1 ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pageSize, offset]),
      this._first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=0 AND is_verified=1'),
    ])
    return { users, total: countRow?.cnt || 0 }
  }
  async getAllUsersRaw() { return this._all('SELECT * FROM users') }

  // ── Whitelist ──────────────────────────────────────────────────────────────────

  async isWhitelisted(userId) { return !!(await this._first('SELECT 1 FROM whitelist WHERE user_id=$1', [userId])) }
  async addToWhitelist(userId, reason, addedBy) {
    await this._execute(
      'INSERT INTO whitelist(user_id,reason,added_by,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET reason=EXCLUDED.reason,added_by=EXCLUDED.added_by,created_at=EXCLUDED.created_at',
      [userId, reason, addedBy, new Date().toISOString()],
    )
  }
  async removeFromWhitelist(userId) { await this._execute('DELETE FROM whitelist WHERE user_id=$1', [userId]) }
  async getWhitelist(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize
    const [entries, countRow] = await Promise.all([
      this._all(
        'SELECT w.*, u.username, u.first_name, u.last_name FROM whitelist w LEFT JOIN users u ON w.user_id=u.user_id ORDER BY w.created_at DESC LIMIT $1 OFFSET $2',
        [pageSize, offset],
      ),
      this._first('SELECT COUNT(*) as cnt FROM whitelist'),
    ])
    return { users: entries, total: countRow?.cnt || 0 }
  }
  async getWhitelistRaw() { return this._all('SELECT * FROM whitelist') }

  // ── Messages ────────────────────────────────────────────────────────────────────

  async addMsg({ userId, direction, content, messageType = 'text', telegramMessageId }) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    const ts = new Date().toISOString()
    const fullContent = typeof content === 'string' ? content : (content == null ? '' : String(content))
    const compact = compactMessageContent(fullContent)
    await this._execute(
      'INSERT INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, userId, direction, fullContent, messageType, telegramMessageId || null, ts],
    )
    await this._execute(
      'INSERT INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_direction=EXCLUDED.last_direction,last_at=EXCLUDED.last_at',
      [userId, compact, direction, ts],
    )
  }
  async updateMsgContentByTelegramMessageId({ userId, direction, telegramMessageId, content, messageType = 'text' }) {
    if (!userId || !direction || telegramMessageId == null) return false

    const fullContent = typeof content === 'string' ? content : (content == null ? '' : String(content))
    await this._execute(
      'UPDATE messages SET content=$1, message_type=$2 WHERE user_id=$3 AND direction=$4 AND telegram_message_id=$5',
      [fullContent, messageType, userId, direction, telegramMessageId],
    )

    const latest = await this._first(
      'SELECT direction, content, created_at FROM messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [userId],
    )
    if (latest) {
      await this._execute(
        'INSERT INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_direction=EXCLUDED.last_direction,last_at=EXCLUDED.last_at',
        [userId, compactMessageContent(latest.content), latest.direction, latest.created_at],
      )
    }
    return true
  }
  async getMsgs(userId, limit = 50, offset = 0) {
    return this._all('SELECT * FROM messages WHERE user_id=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3', [userId, limit, offset])
  }
  async getMsgsSince(userId, since, limit = 50) {
    return this._all('SELECT * FROM messages WHERE user_id=$1 AND created_at>$2 ORDER BY created_at ASC LIMIT $3', [userId, since, limit])
  }
  async getRecentConvs(limit = 40) {
    return this._all(
      'SELECT r.*, u.username, u.first_name, u.last_name, u.is_blocked FROM recent_convs r LEFT JOIN users u ON r.user_id=u.user_id ORDER BY r.last_at DESC LIMIT $1',
      [limit],
    )
  }
  async getRecentConvsSince(since, limit = 40) {
    return this._all(
      'SELECT r.*, u.username, u.first_name, u.last_name, u.is_blocked FROM recent_convs r LEFT JOIN users u ON r.user_id=u.user_id WHERE r.last_at>$1 ORDER BY r.last_at DESC LIMIT $2',
      [since, limit],
    )
  }
  async getAllMsgsRaw() { return this._all('SELECT * FROM messages') }
  async getAllRecentRaw() { return this._all('SELECT * FROM recent_convs') }
  async deleteUserMsgs(userId) {
    await this._execute('DELETE FROM messages WHERE user_id=$1', [userId])
    await this._execute('DELETE FROM recent_convs WHERE user_id=$1', [userId])
  }
  async clearUserThread(userId) {
    const u = await this.getUser(userId)
    if (u?.thread_id) await this._execute('DELETE FROM thread_map WHERE thread_id=$1', [u.thread_id])
    await this._execute('UPDATE users SET thread_id=NULL WHERE user_id=$1', [userId])
  }

  async deleteUser(userId) {
    const uid = Number(userId)
    if (!Number.isFinite(uid)) return false

    const u = await this.getUser(uid)
    if (!u) return false

    await this._execute('DELETE FROM messages WHERE user_id=$1', [uid])
    await this._execute('DELETE FROM recent_convs WHERE user_id=$1', [uid])
    await this._execute('DELETE FROM whitelist WHERE user_id=$1', [uid])
    if (u.thread_id !== null && u.thread_id !== undefined) {
      await this._execute('DELETE FROM thread_map WHERE thread_id=$1', [u.thread_id])
    }
    await this._execute('DELETE FROM users WHERE user_id=$1', [uid])
    return true
  }

  // ── Stats ───────────────────────────────────────────────────────────────────────

  async getStats() {
    const [totalRow, blockedRow, msgRow, todayRow] = await Promise.all([
      this._first('SELECT COUNT(*) as cnt FROM users'),
      this._first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=1'),
      this._first('SELECT COUNT(*) as cnt FROM messages'),
      this._first('SELECT COUNT(*) as cnt FROM messages WHERE created_at LIKE $1', [`${new Date().toISOString().slice(0, 10)}%`]),
    ])
    return {
      totalUsers: totalRow?.cnt || 0,
      blockedUsers: blockedRow?.cnt || 0,
      totalMessages: msgRow?.cnt || 0,
      todayMessages: todayRow?.cnt || 0,
    }
  }

  // ── Web users ───────────────────────────────────────────────────────────────────

  async webUserCount() { const r = await this._first('SELECT COUNT(*) as cnt FROM web_users'); return r?.cnt || 0 }
  async createWebUser(username, passwordHash) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
    const ts = new Date().toISOString()
    await this._execute(
      'INSERT INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at) VALUES($1,$2,$3,NULL,0,1,$4)',
      [id, username, passwordHash, ts],
    )
    return this.getWebUser(username)
  }
  async getWebUser(username) { return this._first('SELECT * FROM web_users WHERE LOWER(username)=LOWER($1)', [username]) }
  async getWebUserById(id) { return this._first('SELECT * FROM web_users WHERE id=$1', [id]) }
  async updateWebUserPassword(id, hash) { await this._execute('UPDATE web_users SET password_hash=$1 WHERE id=$2', [hash, id]) }
  async updateWebUserUsername(id, newUsername) { await this._execute('UPDATE web_users SET username=$1 WHERE id=$2', [newUsername, id]) }
  async setWebUserTotp(id, secret, enabled) { await this._execute('UPDATE web_users SET totp_secret=$1,totp_enabled=$2 WHERE id=$3', [secret, enabled ? 1 : 0, id]) }
  async getAllWebUsersRaw() { return this._all('SELECT * FROM web_users') }

  async clearAppDataPreserveWebUsers(activeDb = 'hyperdrive') {
    await this._execute('DELETE FROM whitelist')
    await this._execute('DELETE FROM recent_convs')
    await this._execute('DELETE FROM messages')
    await this._execute('DELETE FROM thread_map')
    await this._execute('DELETE FROM users')
    await this._execute('DELETE FROM settings')
    await this.setSetting('ACTIVE_DB', activeDb)
  }
}
