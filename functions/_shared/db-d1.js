// functions/_shared/db-d1.js
import { DEFAULT_SETTINGS } from './db-settings.js'

const MAX_STORED_MESSAGE_LENGTH = 1200

function compactMessageContent(content) {
  const raw = typeof content === 'string' ? content : (content == null ? '' : String(content))
  if (raw.length <= MAX_STORED_MESSAGE_LENGTH) return raw
  return raw.slice(0, MAX_STORED_MESSAGE_LENGTH - 1) + '…'
}

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT,
  language_code TEXT, thread_id INTEGER, is_verified INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0, is_permanent_block INTEGER DEFAULT 0,
  block_reason TEXT, blocked_by TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS thread_map (thread_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, direction TEXT,
  content TEXT, message_type TEXT, telegram_message_id INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS recent_convs (
  user_id INTEGER PRIMARY KEY, last_message TEXT, last_direction TEXT, last_at TEXT
);
CREATE TABLE IF NOT EXISTS whitelist (
  user_id INTEGER PRIMARY KEY, reason TEXT, added_by TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS web_users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT,
  totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 1, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`

export class D1Store {
  constructor(d1) { this.d1 = d1 }

  async exec(sql, ...params) {
    const stmt = this.d1.prepare(sql)
    return params.length ? stmt.bind(...params).run() : stmt.run()
  }
  async first(sql, ...params) {
    const stmt = this.d1.prepare(sql)
    return params.length ? stmt.bind(...params).first() : stmt.first()
  }
  async all(sql, ...params) {
    const stmt = this.d1.prepare(sql)
    const res = await (params.length ? stmt.bind(...params).all() : stmt.all())
    return res.results || []
  }

  // Settings
  async getSetting(key) { const r = await this.first('SELECT value FROM settings WHERE key=?', key); return r?.value ?? null }
  async setSetting(key, value) { await this.exec('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', key, value) }
  async getAllSettings() {
    const rows = await this.all('SELECT key,value FROM settings')
    const s = { ...DEFAULT_SETTINGS }
    for (const r of rows) s[r.key] = r.value
    return s
  }

  // Users
  async getUser(userId) { return this.first('SELECT * FROM users WHERE user_id=?', userId) }
  async upsertUser(u) {
    await this.exec(
      `INSERT INTO users(user_id,username,first_name,last_name,language_code,thread_id,is_verified,is_blocked,is_permanent_block,block_reason,blocked_by,created_at)
       VALUES(?,?,?,?,?,?,0,0,0,NULL,NULL,?)
       ON CONFLICT(user_id) DO UPDATE SET
         username=COALESCE(excluded.username,username),
         first_name=COALESCE(excluded.first_name,first_name),
         last_name=COALESCE(excluded.last_name,last_name),
         language_code=COALESCE(excluded.language_code,language_code)`,
      u.user_id, u.username || null, u.first_name || null, u.last_name || null,
      u.language_code || null, u.thread_id || null, u.created_at || new Date().toISOString()
    )
  }
  async setUserThread(userId, threadId) {
    await this.exec('UPDATE users SET thread_id=? WHERE user_id=?', threadId, userId)
    await this.exec('INSERT OR REPLACE INTO thread_map(thread_id,user_id) VALUES(?,?)', threadId, userId)
  }
  async getUserByThread(threadId) {
    const r = await this.first('SELECT user_id FROM thread_map WHERE thread_id=?', threadId)
    return r ? this.getUser(r.user_id) : null
  }
  async setUserVerified(userId, v) { await this.exec('UPDATE users SET is_verified=? WHERE user_id=?', v ? 1 : 0, userId) }
  async blockUser(userId, reason, blockedBy, permanent) {
    await this.exec('UPDATE users SET is_blocked=1,is_permanent_block=?,block_reason=?,blocked_by=? WHERE user_id=?', permanent ? 1 : 0, reason, blockedBy, userId)
    // Ban should take priority over whitelist to avoid conflicting state.
    await this.exec('DELETE FROM whitelist WHERE user_id=?', userId)
  }
  async unblockUser(userId) {
    await this.exec('UPDATE users SET is_blocked=0,is_permanent_block=0,block_reason=NULL,blocked_by=NULL WHERE user_id=?', userId)
  }
  async updateUsername(userId, newUsername) {
    await this.exec('UPDATE users SET username=? WHERE user_id=?', newUsername, userId)
  }
  async searchUsers(query, limit = 10) {
    const q = `%${query}%`
    return this.all('SELECT * FROM users WHERE CAST(user_id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ? LIMIT ?', q, q, q, limit)
  }
  async getAllUsers(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize
    const [users, countRow] = await Promise.all([
      this.all('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM users'),
    ])
    return { users, total: countRow?.cnt || 0 }
  }
  async getBlockedUsers(page = 1, pageSize = 10) {
    const offset = (page - 1) * pageSize
    const [users, countRow] = await Promise.all([
      this.all('SELECT * FROM users WHERE is_blocked=1 ORDER BY created_at DESC LIMIT ? OFFSET ?', pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=1'),
    ])
    return { users, total: countRow?.cnt || 0 }
  }
  async getNormalUsers(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize
    const [users, countRow] = await Promise.all([
      this.all('SELECT * FROM users WHERE is_blocked=0 ORDER BY created_at DESC LIMIT ? OFFSET ?', pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=0'),
    ])
    return { users, total: countRow?.cnt || 0 }
  }
  async getAllUsersRaw() { return this.all('SELECT * FROM users') }

  // Whitelist
  async isWhitelisted(userId) { return !!(await this.first('SELECT 1 FROM whitelist WHERE user_id=?', userId)) }
  async addToWhitelist(userId, reason, addedBy) {
    await this.exec('INSERT OR REPLACE INTO whitelist(user_id,reason,added_by,created_at) VALUES(?,?,?,?)', userId, reason, addedBy, new Date().toISOString())
  }
  async removeFromWhitelist(userId) { await this.exec('DELETE FROM whitelist WHERE user_id=?', userId) }
  async getWhitelist(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize
    const [entries, countRow] = await Promise.all([
      this.all(`SELECT w.*, u.username, u.first_name, u.last_name FROM whitelist w LEFT JOIN users u ON w.user_id=u.user_id ORDER BY w.created_at DESC LIMIT ? OFFSET ?`, pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM whitelist'),
    ])
    return { users: entries, total: countRow?.cnt || 0 }
  }
  async getWhitelistRaw() { return this.all('SELECT * FROM whitelist') }

  // Messages
  async addMsg({ userId, direction, content, messageType = 'text', telegramMessageId }) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    const ts = new Date().toISOString()
    const fullContent = typeof content === 'string' ? content : (content == null ? '' : String(content))
    const compact = compactMessageContent(fullContent)
    await this.exec('INSERT INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at) VALUES(?,?,?,?,?,?,?)', id, userId, direction, fullContent, messageType, telegramMessageId || null, ts)
    await this.exec('INSERT OR REPLACE INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES(?,?,?,?)', userId, compact, direction, ts)
  }
  async getMsgs(userId, limit = 50, offset = 0) {
    return this.all('SELECT * FROM messages WHERE user_id=? ORDER BY created_at ASC LIMIT ? OFFSET ?', userId, limit, offset)
  }
  async getMsgsSince(userId, since, limit = 50) {
    return this.all('SELECT * FROM messages WHERE user_id=? AND created_at>? ORDER BY created_at ASC LIMIT ?', userId, since, limit)
  }
  async getRecentConvs(limit = 40) {
    return this.all(`SELECT r.*, u.username, u.first_name, u.last_name, u.is_blocked FROM recent_convs r LEFT JOIN users u ON r.user_id=u.user_id ORDER BY r.last_at DESC LIMIT ?`, limit)
  }
  async getRecentConvsSince(since, limit = 40) {
    return this.all(`SELECT r.*, u.username, u.first_name, u.last_name, u.is_blocked FROM recent_convs r LEFT JOIN users u ON r.user_id=u.user_id WHERE r.last_at>? ORDER BY r.last_at DESC LIMIT ?`, since, limit)
  }
  async getAllMsgsRaw() { return this.all('SELECT * FROM messages') }
  async getAllRecentRaw() { return this.all('SELECT * FROM recent_convs') }
  async deleteUserMsgs(userId) {
    await this.exec('DELETE FROM messages WHERE user_id=?', userId)
    await this.exec('DELETE FROM recent_convs WHERE user_id=?', userId)
  }
  async clearUserThread(userId) {
    const u = await this.getUser(userId)
    if (u?.thread_id) await this.exec('DELETE FROM thread_map WHERE thread_id=?', u.thread_id)
    await this.exec('UPDATE users SET thread_id=NULL WHERE user_id=?', userId)
  }

  // Verification (always in KV since it's ephemeral — D1Store delegates)
  // These will be overridden at DB level to always use KV

  // Stats
  async getStats() {
    const [totalRow, blockedRow, msgRow, todayRow] = await Promise.all([
      this.first('SELECT COUNT(*) as cnt FROM users'),
      this.first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=1'),
      this.first('SELECT COUNT(*) as cnt FROM messages'),
      this.first(`SELECT COUNT(*) as cnt FROM messages WHERE created_at LIKE ?`, `${new Date().toISOString().slice(0, 10)}%`),
    ])
    return { totalUsers: totalRow?.cnt || 0, blockedUsers: blockedRow?.cnt || 0, totalMessages: msgRow?.cnt || 0, todayMessages: todayRow?.cnt || 0 }
  }

  // Web users
  async webUserCount() { const r = await this.first('SELECT COUNT(*) as cnt FROM web_users'); return r?.cnt || 0 }
  async createWebUser(username, passwordHash) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
    const ts = new Date().toISOString()
    await this.exec('INSERT INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at) VALUES(?,?,?,NULL,0,1,?)', id, username, passwordHash, ts)
    return this.getWebUser(username)
  }
  async getWebUser(username) { return this.first('SELECT * FROM web_users WHERE LOWER(username)=LOWER(?)', username) }
  async getWebUserById(id) { return this.first('SELECT * FROM web_users WHERE id=?', id) }
  async updateWebUserPassword(id, hash) { await this.exec('UPDATE web_users SET password_hash=? WHERE id=?', hash, id) }
  async updateWebUserUsername(id, newUsername) { await this.exec('UPDATE web_users SET username=? WHERE id=?', newUsername, id) }
  async setWebUserTotp(id, secret, enabled) { await this.exec('UPDATE web_users SET totp_secret=?,totp_enabled=? WHERE id=?', secret, enabled ? 1 : 0, id) }
  async getAllWebUsersRaw() { return this.all('SELECT * FROM web_users') }

  async clearAppDataPreserveWebUsers(activeDb = 'kv') {
    await this.exec('DELETE FROM whitelist')
    await this.exec('DELETE FROM recent_convs')
    await this.exec('DELETE FROM messages')
    await this.exec('DELETE FROM thread_map')
    await this.exec('DELETE FROM users')
    await this.exec('DELETE FROM settings')
    await this.setSetting('ACTIVE_DB', activeDb)
  }

  async initSchema() {
    for (const stmt of D1_SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
      await this.exec(stmt)
    }
  }
}
