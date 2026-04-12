// functions/_shared/db.js
import { hashPw } from './auth.js';

// ─── Default settings ────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  BOT_TOKEN: '',
  FORUM_GROUP_ID: '',
  ADMIN_IDS: '',
  VERIFICATION_ENABLED: 'true',
  VERIFICATION_TIMEOUT: '300',
  MAX_VERIFICATION_ATTEMPTS: '3',
  AUTO_UNBLOCK_ENABLED: 'true',
  MAX_MESSAGES_PER_MINUTE: '30',
  WEBHOOK_SECRET: '',
  CAPTCHA_TYPE: 'math',                // math | image_numeric | image_alphanumeric
  CAPTCHA_SITE_URL: '',
  WELCOME_ENABLED: 'true',
  WELCOME_MESSAGE: '👋 欢迎使用双向消息机器人！\n\n请直接发送您的问题或留言，管理员将尽快回复。\n\n发送 /help 查看帮助。',
  BOT_COMMAND_FILTER: 'true',
  WHITELIST_ENABLED: 'false',
  ACTIVE_DB: 'kv',                     // kv | d1
};

// ─── KV helpers ───────────────────────────────────────────────────────────────
async function kvListAll(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const opts = { prefix };
    if (cursor) opts.cursor = cursor;
    const res = await kv.list(opts);
    keys.push(...res.keys);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

// ─── KV Store ────────────────────────────────────────────────────────────────
class KVStore {
  constructor(kv) { this.kv = kv; }

  // Settings
  async getSetting(key) { return this.kv.get(`setting:${key}`); }
  async setSetting(key, value) { await this.kv.put(`setting:${key}`, String(value)); }
  async getAllSettings() {
    const s = { ...DEFAULT_SETTINGS };
    await Promise.all(Object.keys(s).map(async k => {
      const v = await this.kv.get(`setting:${k}`);
      if (v !== null) s[k] = v;
    }));
    return s;
  }

  // Users
  async getUser(userId) {
    const d = await this.kv.get(`user:${userId}`);
    return d ? JSON.parse(d) : null;
  }
  async upsertUser(u) {
    const ex = await this.getUser(u.user_id);
    const rec = { ...ex, ...u, created_at: ex?.created_at || new Date().toISOString() };
    await this.kv.put(`user:${u.user_id}`, JSON.stringify(rec));
    if (u.username) await this.kv.put(`username:${u.username.toLowerCase()}`, String(u.user_id));
  }
  async setUserThread(userId, threadId) {
    const u = await this.getUser(userId);
    if (u) { u.thread_id = threadId; await this.kv.put(`user:${userId}`, JSON.stringify(u)); }
    await this.kv.put(`thread:${threadId}`, String(userId));
  }
  async getUserByThread(threadId) {
    const uid = await this.kv.get(`thread:${threadId}`);
    return uid ? this.getUser(parseInt(uid, 10)) : null;
  }
  async setUserVerified(userId, v) {
    const u = await this.getUser(userId);
    if (u) { u.is_verified = v ? 1 : 0; await this.kv.put(`user:${userId}`, JSON.stringify(u)); }
  }
  async blockUser(userId, reason, blockedBy, permanent) {
    const u = await this.getUser(userId);
    if (u) {
      Object.assign(u, { is_blocked: 1, is_permanent_block: permanent ? 1 : 0, block_reason: reason, blocked_by: blockedBy });
      await this.kv.put(`user:${userId}`, JSON.stringify(u));
    }
  }
  async unblockUser(userId) {
    const u = await this.getUser(userId);
    if (u) {
      Object.assign(u, { is_blocked: 0, is_permanent_block: 0, block_reason: null, blocked_by: null });
      await this.kv.put(`user:${userId}`, JSON.stringify(u));
    }
  }
  async updateUsername(userId, newUsername) {
    const u = await this.getUser(userId);
    if (u) {
      if (u.username) await this.kv.delete(`username:${u.username.toLowerCase()}`);
      u.username = newUsername;
      await this.kv.put(`user:${userId}`, JSON.stringify(u));
      if (newUsername) await this.kv.put(`username:${newUsername.toLowerCase()}`, String(userId));
    }
  }
  async searchUsers(query, limit = 10) {
    const results = [];
    const q = query.toLowerCase();
    for (const key of await kvListAll(this.kv, 'user:')) {
      if (results.length >= limit) break;
      const d = await this.kv.get(key.name);
      if (!d) continue;
      const u = JSON.parse(d);
      if (String(u.user_id).includes(q) || (u.username?.toLowerCase().includes(q)) || (u.first_name?.toLowerCase().includes(q)))
        results.push(u);
    }
    return results;
  }
  async getAllUsers(page = 1, pageSize = 20) {
    const all = (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { users: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  }
  async getBlockedUsers(page = 1, pageSize = 10) {
    const all = (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(u => u?.is_blocked);
    const start = (page - 1) * pageSize;
    return { users: all.slice(start, start + pageSize), total: all.length };
  }
  async getAllUsersRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
  }

  // Whitelist
  async isWhitelisted(userId) { return !!(await this.kv.get(`whitelist:${userId}`)); }
  async addToWhitelist(userId, reason, addedBy) {
    await this.kv.put(`whitelist:${userId}`, JSON.stringify({ user_id: userId, reason, added_by: addedBy, created_at: new Date().toISOString() }));
  }
  async removeFromWhitelist(userId) { await this.kv.delete(`whitelist:${userId}`); }
  async getWhitelist(page = 1, pageSize = 20) {
    const entries = (await Promise.all((await kvListAll(this.kv, 'whitelist:')).map(async k => {
      const d = await this.kv.get(k.name);
      if (!d) return null;
      const wl = JSON.parse(d);
      const u  = await this.getUser(wl.user_id);
      return { ...wl, ...(u || {}) };
    }))).filter(Boolean);
    entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { users: entries.slice((page - 1) * pageSize, page * pageSize), total: entries.length };
  }
  async getWhitelistRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'whitelist:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
  }

  // Messages
  async addMsg({ userId, direction, content, messageType = 'text', telegramMessageId }) {
    const id  = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const msg = { id, user_id: userId, direction, content: content || '', message_type: messageType, telegram_message_id: telegramMessageId, created_at: new Date().toISOString() };
    await this.kv.put(`msg:${userId}:${id}`, JSON.stringify(msg));
    await this.kv.put(`recent:${userId}`, JSON.stringify({ user_id: userId, last_message: content, last_direction: direction, last_at: msg.created_at }));
  }
  async getMsgs(userId, limit = 50, offset = 0) {
    const msgs = (await Promise.all((await kvListAll(this.kv, `msg:${userId}:`)).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return msgs.slice(offset, offset + limit);
  }
  async getRecentConvs(limit = 40) {
    const convs = (await Promise.all((await kvListAll(this.kv, 'recent:')).map(async k => {
      const d = await this.kv.get(k.name);
      if (!d) return null;
      const c = JSON.parse(d);
      const u = await this.getUser(c.user_id);
      return { ...c, ...(u || {}) };
    }))).filter(Boolean);
    convs.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
    return convs.slice(0, limit);
  }
  async getAllMsgsRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'msg:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
  }
  async getAllRecentRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'recent:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
  }

  // Verification
  async setVerify(userId, data, ttlSeconds = 300) {
    const ttl = Math.max(60, ttlSeconds); // CF KV minimum TTL is 60s
    const rec = { user_id: userId, attempts: 0, expires_at: Date.now() + ttl * 1000, ...data };
    await this.kv.put(`verify:${userId}`, JSON.stringify(rec), { expirationTtl: ttl });
  }
  async getVerify(userId) { const d = await this.kv.get(`verify:${userId}`); return d ? JSON.parse(d) : null; }
  async incVerify(userId) {
    const v = await this.getVerify(userId);
    if (v) {
      v.attempts++;
      const ttl = Math.max(60, Math.floor((v.expires_at - Date.now()) / 1000));
      await this.kv.put(`verify:${userId}`, JSON.stringify(v), { expirationTtl: ttl });
    }
  }
  async delVerify(userId) { await this.kv.delete(`verify:${userId}`).catch(() => {}); }

  // Stats
  async getStats() {
    const [userKeys, msgKeys] = await Promise.all([kvListAll(this.kv, 'user:'), kvListAll(this.kv, 'msg:')]);
    const userData = await Promise.all(userKeys.map(k => this.kv.get(k.name)));
    const blockedCount = userData.reduce((n, d) => n + (d && JSON.parse(d).is_blocked ? 1 : 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    let todayMsgs = 0;
    for (const k of msgKeys) {
      const ts = parseInt(k.name.split(':')[2]?.split('_')[0], 10);
      if (!isNaN(ts) && new Date(ts).toISOString().slice(0, 10) === today) todayMsgs++;
    }
    return { totalUsers: userKeys.length, blockedUsers: blockedCount, totalMessages: msgKeys.length, todayMessages: todayMsgs };
  }

  // Web users
  async webUserCount() { return (await kvListAll(this.kv, 'webuser:')).length; }
  async createWebUser(username, passwordHash) {
    const id   = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const user = { id, username, password_hash: passwordHash, totp_secret: null, totp_enabled: 0, is_admin: 1, created_at: new Date().toISOString() };
    await this.kv.put(`webuser:${username.toLowerCase()}`, JSON.stringify(user));
    await this.kv.put(`webuser_id:${id}`, JSON.stringify(user));
    return user;
  }
  async getWebUser(username) { const d = await this.kv.get(`webuser:${username.toLowerCase()}`); return d ? JSON.parse(d) : null; }
  async getWebUserById(id) { const d = await this.kv.get(`webuser_id:${id}`); return d ? JSON.parse(d) : null; }
  async updateWebUserPassword(id, hash) {
    const u = await this.getWebUserById(id);
    if (u) { u.password_hash = hash; await this._saveWebUser(u); }
  }
  async updateWebUserUsername(id, newUsername) {
    const u = await this.getWebUserById(id);
    if (!u) return;
    await this.kv.delete(`webuser:${u.username.toLowerCase()}`);
    u.username = newUsername;
    await this._saveWebUser(u);
  }
  async setWebUserTotp(id, secret, enabled) {
    const u = await this.getWebUserById(id);
    if (u) { u.totp_secret = secret; u.totp_enabled = enabled ? 1 : 0; await this._saveWebUser(u); }
  }
  async _saveWebUser(u) {
    await this.kv.put(`webuser:${u.username.toLowerCase()}`, JSON.stringify(u));
    await this.kv.put(`webuser_id:${u.id}`, JSON.stringify(u));
  }
  async getAllWebUsersRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'webuser_id:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean);
  }
}

// ─── D1 Store ────────────────────────────────────────────────────────────────
const D1_SCHEMA = `
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
`;

class D1Store {
  constructor(d1) { this.d1 = d1; }

  async exec(sql, ...params) {
    const stmt = this.d1.prepare(sql);
    return params.length ? stmt.bind(...params).run() : stmt.run();
  }
  async first(sql, ...params) {
    const stmt = this.d1.prepare(sql);
    return params.length ? stmt.bind(...params).first() : stmt.first();
  }
  async all(sql, ...params) {
    const stmt = this.d1.prepare(sql);
    const res  = await (params.length ? stmt.bind(...params).all() : stmt.all());
    return res.results || [];
  }

  // Settings
  async getSetting(key) { const r = await this.first('SELECT value FROM settings WHERE key=?', key); return r?.value ?? null; }
  async setSetting(key, value) { await this.exec('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', key, value); }
  async getAllSettings() {
    const rows = await this.all('SELECT key,value FROM settings');
    const s    = { ...DEFAULT_SETTINGS };
    for (const r of rows) s[r.key] = r.value;
    return s;
  }

  // Users
  async getUser(userId) { return this.first('SELECT * FROM users WHERE user_id=?', userId); }
  async upsertUser(u) {
    await this.exec(
      `INSERT INTO users(user_id,username,first_name,last_name,language_code,thread_id,is_verified,is_blocked,is_permanent_block,block_reason,blocked_by,created_at)
       VALUES(?,?,?,?,?,?,0,0,0,NULL,NULL,?)
       ON CONFLICT(user_id) DO UPDATE SET
         username=COALESCE(excluded.username,username),
         first_name=COALESCE(excluded.first_name,first_name),
         last_name=COALESCE(excluded.last_name,last_name),
         language_code=COALESCE(excluded.language_code,language_code)`,
      u.user_id, u.username||null, u.first_name||null, u.last_name||null,
      u.language_code||null, u.thread_id||null, u.created_at||new Date().toISOString()
    );
  }
  async setUserThread(userId, threadId) {
    await this.exec('UPDATE users SET thread_id=? WHERE user_id=?', threadId, userId);
    await this.exec('INSERT OR REPLACE INTO thread_map(thread_id,user_id) VALUES(?,?)', threadId, userId);
  }
  async getUserByThread(threadId) {
    const r = await this.first('SELECT user_id FROM thread_map WHERE thread_id=?', threadId);
    return r ? this.getUser(r.user_id) : null;
  }
  async setUserVerified(userId, v) { await this.exec('UPDATE users SET is_verified=? WHERE user_id=?', v ? 1 : 0, userId); }
  async blockUser(userId, reason, blockedBy, permanent) {
    await this.exec('UPDATE users SET is_blocked=1,is_permanent_block=?,block_reason=?,blocked_by=? WHERE user_id=?', permanent ? 1 : 0, reason, blockedBy, userId);
  }
  async unblockUser(userId) {
    await this.exec('UPDATE users SET is_blocked=0,is_permanent_block=0,block_reason=NULL,blocked_by=NULL WHERE user_id=?', userId);
  }
  async updateUsername(userId, newUsername) {
    await this.exec('UPDATE users SET username=? WHERE user_id=?', newUsername, userId);
  }
  async searchUsers(query, limit = 10) {
    const q = `%${query}%`;
    return this.all('SELECT * FROM users WHERE CAST(user_id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ? LIMIT ?', q, q, q, limit);
  }
  async getAllUsers(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const [users, countRow] = await Promise.all([
      this.all('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM users'),
    ]);
    return { users, total: countRow?.cnt || 0 };
  }
  async getBlockedUsers(page = 1, pageSize = 10) {
    const offset = (page - 1) * pageSize;
    const [users, countRow] = await Promise.all([
      this.all('SELECT * FROM users WHERE is_blocked=1 ORDER BY user_id DESC LIMIT ? OFFSET ?', pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=1'),
    ]);
    return { users, total: countRow?.cnt || 0 };
  }
  async getAllUsersRaw() { return this.all('SELECT * FROM users'); }

  // Whitelist
  async isWhitelisted(userId) { return !!(await this.first('SELECT 1 FROM whitelist WHERE user_id=?', userId)); }
  async addToWhitelist(userId, reason, addedBy) {
    await this.exec('INSERT OR REPLACE INTO whitelist(user_id,reason,added_by,created_at) VALUES(?,?,?,?)', userId, reason, addedBy, new Date().toISOString());
  }
  async removeFromWhitelist(userId) { await this.exec('DELETE FROM whitelist WHERE user_id=?', userId); }
  async getWhitelist(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const [entries, countRow] = await Promise.all([
      this.all(`SELECT w.*, u.username, u.first_name, u.last_name FROM whitelist w LEFT JOIN users u ON w.user_id=u.user_id ORDER BY w.created_at DESC LIMIT ? OFFSET ?`, pageSize, offset),
      this.first('SELECT COUNT(*) as cnt FROM whitelist'),
    ]);
    return { users: entries, total: countRow?.cnt || 0 };
  }
  async getWhitelistRaw() { return this.all('SELECT * FROM whitelist'); }

  // Messages
  async addMsg({ userId, direction, content, messageType = 'text', telegramMessageId }) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const ts = new Date().toISOString();
    await this.exec('INSERT INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at) VALUES(?,?,?,?,?,?,?)', id, userId, direction, content||'', messageType, telegramMessageId||null, ts);
    await this.exec('INSERT OR REPLACE INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES(?,?,?,?)', userId, content, direction, ts);
  }
  async getMsgs(userId, limit = 50, offset = 0) {
    return this.all('SELECT * FROM messages WHERE user_id=? ORDER BY created_at ASC LIMIT ? OFFSET ?', userId, limit, offset);
  }
  async getRecentConvs(limit = 40) {
    return this.all(`SELECT r.*, u.username, u.first_name, u.last_name, u.is_blocked FROM recent_convs r LEFT JOIN users u ON r.user_id=u.user_id ORDER BY r.last_at DESC LIMIT ?`, limit);
  }
  async getAllMsgsRaw() { return this.all('SELECT * FROM messages'); }
  async getAllRecentRaw() { return this.all('SELECT * FROM recent_convs'); }

  // Verification (always in KV since it's ephemeral — D1Store delegates)
  // These will be overridden at DB level to always use KV

  // Stats
  async getStats() {
    const [totalRow, blockedRow, msgRow, todayRow] = await Promise.all([
      this.first('SELECT COUNT(*) as cnt FROM users'),
      this.first('SELECT COUNT(*) as cnt FROM users WHERE is_blocked=1'),
      this.first('SELECT COUNT(*) as cnt FROM messages'),
      this.first(`SELECT COUNT(*) as cnt FROM messages WHERE created_at LIKE ?`, `${new Date().toISOString().slice(0, 10)}%`),
    ]);
    return { totalUsers: totalRow?.cnt || 0, blockedUsers: blockedRow?.cnt || 0, totalMessages: msgRow?.cnt || 0, todayMessages: todayRow?.cnt || 0 };
  }

  // Web users
  async webUserCount() { const r = await this.first('SELECT COUNT(*) as cnt FROM web_users'); return r?.cnt || 0; }
  async createWebUser(username, passwordHash) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const ts = new Date().toISOString();
    await this.exec('INSERT INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at) VALUES(?,?,?,NULL,0,1,?)', id, username, passwordHash, ts);
    return this.getWebUser(username);
  }
  async getWebUser(username) { return this.first('SELECT * FROM web_users WHERE LOWER(username)=LOWER(?)', username); }
  async getWebUserById(id) { return this.first('SELECT * FROM web_users WHERE id=?', id); }
  async updateWebUserPassword(id, hash) { await this.exec('UPDATE web_users SET password_hash=? WHERE id=?', hash, id); }
  async updateWebUserUsername(id, newUsername) { await this.exec('UPDATE web_users SET username=? WHERE id=?', newUsername, id); }
  async setWebUserTotp(id, secret, enabled) { await this.exec('UPDATE web_users SET totp_secret=?,totp_enabled=? WHERE id=?', secret, enabled ? 1 : 0, id); }
  async getAllWebUsersRaw() { return this.all('SELECT * FROM web_users'); }

  async initSchema() {
    for (const stmt of D1_SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
      await this.exec(stmt);
    }
  }
}

// ─── Main DB class ────────────────────────────────────────────────────────────
export class DB {
  constructor(kv, d1 = null) {
    this.kv  = kv;
    this.d1  = d1;
    this._kv = new KVStore(kv);
    this._d1 = d1 ? new D1Store(d1) : null;
    this._activeStore = null;
  }

  async _store() {
    if (this._activeStore) return this._activeStore;
    const active = (await this.kv.get('config:active_db')) || 'kv';
    this._activeStore = (active === 'd1' && this._d1) ? this._d1 : this._kv;
    return this._activeStore;
  }

  // Verification always uses KV (ephemeral data, TTL support)
  async setVerify(userId, data, ttlSeconds = 300) { return this._kv.setVerify(userId, data, ttlSeconds); }
  async getVerify(userId)  { return this._kv.getVerify(userId); }
  async incVerify(userId)  { return this._kv.incVerify(userId); }
  async delVerify(userId)  { return this._kv.delVerify(userId); }

  // All other methods delegate to active store
  async getSetting(key)             { return (await this._store()).getSetting(key); }
  async setSetting(key, val)        { return (await this._store()).setSetting(key, val); }
  async getAllSettings()            { return (await this._store()).getAllSettings(); }

  async getUser(id)                        { return (await this._store()).getUser(id); }
  async upsertUser(u)                      { return (await this._store()).upsertUser(u); }
  async setUserThread(uid, tid)            { return (await this._store()).setUserThread(uid, tid); }
  async getUserByThread(tid)               { return (await this._store()).getUserByThread(tid); }
  async setUserVerified(uid, v)            { return (await this._store()).setUserVerified(uid, v); }
  async blockUser(uid, r, by, perm)        { return (await this._store()).blockUser(uid, r, by, perm); }
  async unblockUser(uid)                   { return (await this._store()).unblockUser(uid); }
  async updateUsername(uid, name)          { return (await this._store()).updateUsername(uid, name); }
  async searchUsers(q, lim)               { return (await this._store()).searchUsers(q, lim); }
  async getAllUsers(p, ps)                 { return (await this._store()).getAllUsers(p, ps); }
  async getBlockedUsers(p, ps)            { return (await this._store()).getBlockedUsers(p, ps); }

  async isWhitelisted(uid)                { return (await this._store()).isWhitelisted(uid); }
  async addToWhitelist(uid, r, by)        { return (await this._store()).addToWhitelist(uid, r, by); }
  async removeFromWhitelist(uid)          { return (await this._store()).removeFromWhitelist(uid); }
  async getWhitelist(p, ps)              { return (await this._store()).getWhitelist(p, ps); }

  async addMsg(opts)                       { return (await this._store()).addMsg(opts); }
  async getMsgs(uid, lim, off)            { return (await this._store()).getMsgs(uid, lim, off); }
  async getRecentConvs(lim)              { return (await this._store()).getRecentConvs(lim); }
  async getStats()                        { return (await this._store()).getStats(); }

  async webUserCount()                    { return (await this._store()).webUserCount(); }
  async createWebUser(u, h)              { return (await this._store()).createWebUser(u, h); }
  async getWebUser(u)                    { return (await this._store()).getWebUser(u); }
  async getWebUserById(id)              { return (await this._store()).getWebUserById(id); }
  async updateWebUserPassword(id, h)    { return (await this._store()).updateWebUserPassword(id, h); }
  async updateWebUserUsername(id, u)    { return (await this._store()).updateWebUserUsername(id, u); }
  async setWebUserTotp(id, s, e)        { return (await this._store()).setWebUserTotp(id, s, e); }

  /** Switch active DB and optionally sync data. */
  async switchDb(target) {
    if (target !== 'kv' && target !== 'd1') throw new Error('Invalid target');
    if (target === 'd1' && !this._d1) throw new Error('D1 not bound');
    await this.kv.put('config:active_db', target);
    this._activeStore = null; // reset cache
  }

  /** Full sync from KV → D1 or D1 → KV. Idempotent — safe to call multiple times. */
  async syncData(from, to) {
    const src = from === 'kv' ? this._kv : this._d1;
    const dst = to   === 'kv' ? this._kv : this._d1;
    if (!src || !dst) throw new Error('Store not available');

    if (to === 'd1') await this._d1.initSchema();

    // Settings
    const settings = await src.getAllSettings();
    for (const [k, v] of Object.entries(settings)) await dst.setSetting(k, v);

    // Users (upsertUser uses ON CONFLICT / overwrite — safe)
    for (const u of await src.getAllUsersRaw()) await dst.upsertUser(u);

    // Whitelist: use INSERT OR REPLACE in D1, overwrite in KV
    const wl = await src.getWhitelistRaw();
    if (to === 'd1') {
      for (const e of wl) {
        await this._d1.exec(
          'INSERT OR REPLACE INTO whitelist(user_id,reason,added_by,created_at) VALUES(?,?,?,?)',
          e.user_id, e.reason || '', e.added_by || '', e.created_at || new Date().toISOString()
        );
      }
    } else {
      for (const e of wl) await this._kv.addToWhitelist(e.user_id, e.reason, e.added_by);
    }

    // Messages: INSERT OR IGNORE in D1 (keyed by id), overwrite in KV
    const msgs = await src.getAllMsgsRaw();
    if (to === 'd1') {
      for (const m of msgs) {
        await this._d1.exec(
          `INSERT OR IGNORE INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at)
           VALUES(?,?,?,?,?,?,?)`,
          m.id, m.user_id, m.direction, m.content || '', m.message_type || 'text',
          m.telegram_message_id || null, m.created_at || new Date().toISOString()
        );
      }
    } else {
      for (const m of msgs) await this._kv.addMsg(m);
    }

    // Web users — preserve original ID to avoid UNIQUE re-insert on repeated sync
    const wu = await src.getAllWebUsersRaw();
    if (to === 'd1') {
      for (const u of wu) {
        // INSERT OR REPLACE keeps the row idempotent on both username and id
        await this._d1.exec(
          `INSERT OR REPLACE INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at)
           VALUES(?,?,?,?,?,?,?)`,
          u.id, u.username, u.password_hash,
          u.totp_secret || null, u.totp_enabled ? 1 : 0,
          u.is_admin ? 1 : 1, u.created_at || new Date().toISOString()
        );
      }
    } else {
      for (const u of wu) {
        await this._kv.kv.put(`webuser:${u.username.toLowerCase()}`, JSON.stringify(u));
        await this._kv.kv.put(`webuser_id:${u.id}`, JSON.stringify(u));
      }
    }
  }

  async ensureDefaultAdmin() {
    try {
      // KV lock prevents re-running on every cold start
      if (await this.kv.get('init:admin_done')) return;

      // Always init D1 schema so it's ready before any queries
      if (this._d1) await this._d1.initSchema().catch(e => console.error('D1 initSchema:', e));

      // Check against the currently active store
      if ((await this.webUserCount()) === 0) {
        await this.createWebUser('admin', await hashPw('admins'));
        console.log('Default admin created: admin / admins');
      }
      await this.kv.put('init:admin_done', '1');
    } catch (e) { console.error('ensureDefaultAdmin:', e); }
  }
}
