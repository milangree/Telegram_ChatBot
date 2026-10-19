// functions/_shared/db-kv.js
import { DEFAULT_SETTINGS } from './db-settings.js'

const MAX_STORED_MESSAGE_LENGTH = 1200

function compactMessageContent(content) {
  const raw = typeof content === 'string' ? content : (content == null ? '' : String(content))
  if (raw.length <= MAX_STORED_MESSAGE_LENGTH) return raw
  return raw.slice(0, MAX_STORED_MESSAGE_LENGTH - 1) + '…'
}

// ── In-memory list cache for kvListAll results ───────────────────────────────
const _listCache = new Map()
const LIST_CACHE_TTL = 3000 // 3s TTL for list results

function _getCachedList(prefix) {
  const hit = _listCache.get(prefix)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) { _listCache.delete(prefix); return null }
  return hit.keys
}

function _setCachedList(prefix, keys) {
  _listCache.set(prefix, { keys, expiresAt: Date.now() + LIST_CACHE_TTL })
  // Cap size to avoid memory leak
  if (_listCache.size > 200) {
    const oldest = _listCache.entries().next().value
    if (oldest) _listCache.delete(oldest[0])
  }
}

function _clearListCache(prefix) {
  if (prefix) _listCache.delete(prefix)
  else _listCache.clear()
}

function _invalidateListsContaining(prefix) {
  for (const [key] of _listCache) {
    if (key.startsWith(prefix)) _listCache.delete(key)
  }
}

export async function kvListAll(kv, prefix) {
  const cached = _getCachedList(prefix)
  if (cached) return cached
  const keys = []
  let cursor
  do {
    const opts = { prefix, limit: 1000 }
    if (cursor) opts.cursor = cursor
    const res = await kv.list(opts)
    keys.push(...res.keys)
    cursor = res.list_complete ? undefined : res.cursor
  } while (cursor)
  _setCachedList(prefix, keys)
  return keys
}

export class KVStore {
  constructor(kv) {
    this.kv = kv
    this.cache = new Map()
    this.defaultCacheTtlMs = 60000         // 60s default (increased from 30s)
    this.settingsCacheTtlMs = 120000       // 120s for settings (rarely change, increased from 60s)
    this.userCacheTtlMs = 120000           // 120s for user data (increased from 30s)
    this.whitelistCacheTtlMs = 120000      // 120s for whitelist data
    this.messageCacheTtlMs = 30000         // 30s for message data
    this.settingsCacheKey = '_all_settings'
    this.negativeCacheTtlMs = 10000         // 10s negative cache for null values (increased from 5s)
  }

  _cacheGet(key) {
    const hit = this.cache.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= Date.now()) {
      this.cache.delete(key)
      return undefined
    }
    return hit.value
  }

  _cacheSet(key, value, ttlMs = this.defaultCacheTtlMs) {
    // Cap cached object size to prevent memory bloat
    if (value !== null && typeof value === 'object') {
      try {
        const size = JSON.stringify(value).length
        if (size > 100 * 1024) return value // don't cache objects >100KB
      } catch {}
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs })
    // GC stale entries once cache grows large
    if (this.cache.size > 5000) this._gc()
    return value
  }

  _cacheDelete(key) {
    this.cache.delete(key)
  }

  /** Evict ~25% of stale entries when cache is oversized */
  _gc() {
    const threshold = Date.now()
    let deleted = 0
    for (const [k, v] of this.cache) {
      if (v.expiresAt <= threshold) { this.cache.delete(k); deleted++ }
      if (deleted > this.cache.size * 0.25) break
    }
  }

  /** Invalidate cached getAllSettings() result */
  _invalidateSettingsCache() {
    this._cacheDelete(this.settingsCacheKey)
  }

  // Settings
  async getSetting(key) {
    const ck = `setting:${key}`
    const cached = this._cacheGet(ck)
    if (cached !== undefined) return cached
    const v = await this.kv.get(ck)
    // Negative cache for null/empty
    if (v === null || v === undefined || v === '') {
      this._cacheSet(ck, null, this.negativeCacheTtlMs)
      return null
    }
    this._cacheSet(ck, v, this.settingsCacheTtlMs)
    return v
  }
  async setSetting(key, value) {
    const ck = `setting:${key}`
    const sv = String(value)
    await this.kv.put(ck, sv)
    this._cacheSet(ck, sv, this.settingsCacheTtlMs)
    this._invalidateSettingsCache()
  }
  async getAllSettings() {
    const cached = this._cacheGet(this.settingsCacheKey)
    if (cached !== undefined) return { ...cached } // return a shallow copy
    const s = { ...DEFAULT_SETTINGS }
    await Promise.all(Object.keys(s).map(async k => {
      const v = await this.getSetting(k)
      if (v !== null) s[k] = v
    }))
    this._cacheSet(this.settingsCacheKey, { ...s }, this.settingsCacheTtlMs)
    return s
  }

  /** 批量读取多个设置（减少 KV 读写次数） */
  async getSettingsBatch(keys) {
    const result = {}
    const missingKeys = []

    // 先从缓存读取
    for (const key of keys) {
      const ck = `setting:${key}`
      const cached = this._cacheGet(ck)
      if (cached !== undefined) {
        result[key] = cached
      } else {
        missingKeys.push(key)
      }
    }

    // 批量读取缺失的设置
    if (missingKeys.length > 0) {
      await Promise.all(missingKeys.map(async (key) => {
        const ck = `setting:${key}`
        const v = await this.kv.get(ck)
        if (v !== null && v !== undefined && v !== '') {
          this._cacheSet(ck, v, this.settingsCacheTtlMs)
          result[key] = v
        } else {
          this._cacheSet(ck, null, this.negativeCacheTtlMs)
        }
      }))
    }

    return result
  }

  // Users
  async getUser(userId) {
    const key = `user:${userId}`
    const cached = this._cacheGet(key)
    if (cached !== undefined) return cached
    const d = await this.kv.get(key)
    const parsed = d ? JSON.parse(d) : null
    this._cacheSet(key, parsed, parsed ? this.userCacheTtlMs : this.negativeCacheTtlMs)
    return parsed
  }
  async upsertUser(u) {
    const ex = await this.getUser(u.user_id)
    const rec = { ...ex, ...u, created_at: ex?.created_at || new Date().toISOString() }
    await this.kv.put(`user:${u.user_id}`, JSON.stringify(rec))
    this._cacheSet(`user:${u.user_id}`, rec)
    if (u.username) await this.kv.put(`username:${u.username.toLowerCase()}`, String(u.user_id))
    _invalidateListsContaining('user:')
  }
  async setUserThread(userId, threadId) {
    const u = await this.getUser(userId)
    if (u) { u.thread_id = threadId; await this.kv.put(`user:${userId}`, JSON.stringify(u)) }
    await this.kv.put(`thread:${threadId}`, String(userId))
    _invalidateListsContaining('user:')
  }
  async getUserByThread(threadId) {
    const uid = await this.kv.get(`thread:${threadId}`)
    return uid ? this.getUser(parseInt(uid, 10)) : null
  }
  async setUserVerified(userId, v) {
    const u = await this.getUser(userId)
    if (u) { u.is_verified = v ? 1 : 0; await this.kv.put(`user:${userId}`, JSON.stringify(u)) }
    _invalidateListsContaining('user:')
  }
  async blockUser(userId, reason, blockedBy, permanent) {
    const u = await this.getUser(userId)
    if (u) {
      Object.assign(u, { is_blocked: 1, is_permanent_block: permanent ? 1 : 0, block_reason: reason, blocked_by: blockedBy })
      await this.kv.put(`user:${userId}`, JSON.stringify(u))
      this._cacheSet(`user:${userId}`, u)
    }
    // Ban should take priority over whitelist to avoid conflicting state.
    await this.removeFromWhitelist(userId).catch(() => {})
    _invalidateListsContaining('user:')
  }
  async unblockUser(userId) {
    const u = await this.getUser(userId)
    if (u) {
      Object.assign(u, { is_blocked: 0, is_permanent_block: 0, block_reason: null, blocked_by: null })
      await this.kv.put(`user:${userId}`, JSON.stringify(u))
      this._cacheSet(`user:${userId}`, u)
    }
    _invalidateListsContaining('user:')
  }
  async updateUsername(userId, newUsername) {
    const u = await this.getUser(userId)
    if (u) {
      if (u.username) await this.kv.delete(`username:${u.username.toLowerCase()}`)
      u.username = newUsername
      await this.kv.put(`user:${userId}`, JSON.stringify(u))
      if (newUsername) await this.kv.put(`username:${newUsername.toLowerCase()}`, String(userId))
    }
    _invalidateListsContaining('user:')
  }
  async searchUsers(query, limit = 10) {
    const results = []
    const q = query.toLowerCase()
    for (const key of await kvListAll(this.kv, 'user:')) {
      if (results.length >= limit) break
      const d = await this.kv.get(key.name)
      if (!d) continue
      const u = JSON.parse(d)
      if (String(u.user_id).includes(q) || (u.username?.toLowerCase().includes(q)) || (u.first_name?.toLowerCase().includes(q)))
        results.push(u)
    }
    return results
  }
  async getAllUsers(page = 1, pageSize = 20) {
    const all = (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null))))
      .filter(u => u && u.is_verified)
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return { users: all.slice((page - 1) * pageSize, page * pageSize), total: all.length }
  }
  async getBlockedUsers(page = 1, pageSize = 10) {
    const all = (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null))))
      .filter(u => u?.is_blocked && u?.is_verified)
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    const start = (page - 1) * pageSize
    return { users: all.slice(start, start + pageSize), total: all.length }
  }
  async getNormalUsers(page = 1, pageSize = 20) {
    const all = (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null))))
      .filter(u => u && !u.is_blocked && u.is_verified)
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    const start = (page - 1) * pageSize
    return { users: all.slice(start, start + pageSize), total: all.length }
  }
  async getAllUsersRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'user:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean)
  }

  // Whitelist
  async isWhitelisted(userId) {
    const key = `whitelist:${userId}`
    const cached = this._cacheGet(key)
    if (cached !== undefined) return !!cached
    const raw = await this.kv.get(key)
    this._cacheSet(key, raw)
    return !!raw
  }
  async addToWhitelist(userId, reason, addedBy) {
    const key = `whitelist:${userId}`
    const val = JSON.stringify({ user_id: userId, reason, added_by: addedBy, created_at: new Date().toISOString() })
    await this.kv.put(key, val)
    this._cacheSet(key, val)
    _invalidateListsContaining('whitelist:')
  }
  async removeFromWhitelist(userId) {
    const key = `whitelist:${userId}`
    await this.kv.delete(key)
    this._cacheDelete(key)
    _invalidateListsContaining('whitelist:')
  }
  async getWhitelist(page = 1, pageSize = 20) {
    const entries = (await Promise.all((await kvListAll(this.kv, 'whitelist:')).map(async k => {
      const d = await this.kv.get(k.name)
      if (!d) return null
      const wl = JSON.parse(d)
      const u = await this.getUser(wl.user_id)
      return { ...wl, ...(u || {}) }
    }))).filter(Boolean)
    entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return { users: entries.slice((page - 1) * pageSize, page * pageSize), total: entries.length }
  }
  async getWhitelistRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'whitelist:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean)
  }

  // Messages
  async addMsg({ userId, direction, content, messageType = 'text', telegramMessageId }) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    const ts = new Date().toISOString()
    const fullContent = typeof content === 'string' ? content : (content == null ? '' : String(content))
    const compact = compactMessageContent(fullContent)
    const msg = { id, user_id: userId, direction, content: fullContent, message_type: messageType, telegram_message_id: telegramMessageId, created_at: ts }
    await this.kv.put(`msg:${userId}:${id}`, JSON.stringify(msg))
    await this.kv.put(`recent:${userId}`, JSON.stringify({ user_id: userId, last_message: compact, last_direction: direction, last_at: ts }))
    // 使统计缓存失效
    await this.kv.delete('stats:cache').catch(() => {})
    _invalidateListsContaining('msg:')
    _invalidateListsContaining('recent:')
  }
  async updateMsgContentByTelegramMessageId({ userId, direction, telegramMessageId, content, messageType = 'text' }) {
    if (!userId || !direction || telegramMessageId == null) return false

    const keys = await kvListAll(this.kv, `msg:${userId}:`)
    const targetTelegramMessageId = String(telegramMessageId)
    const fullContent = typeof content === 'string' ? content : (content == null ? '' : String(content))
    let updated = false

    for (const key of keys) {
      const raw = await this.kv.get(key.name)
      if (!raw) continue
      const msg = JSON.parse(raw)
      if (String(msg?.direction || '') !== String(direction)) continue
      if (String(msg?.telegram_message_id ?? '') !== targetTelegramMessageId) continue

      msg.content = fullContent
      msg.message_type = messageType
      await this.kv.put(key.name, JSON.stringify(msg))
      updated = true
    }

    const msgs = (await Promise.all(
      (await kvListAll(this.kv, `msg:${userId}:`)).map((k) =>
        this.kv.get(k.name).then((d) => (d ? JSON.parse(d) : null)),
      ),
    )).filter(Boolean)
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    const latest = msgs[msgs.length - 1]
    if (latest) {
      await this.kv.put(
        `recent:${userId}`,
        JSON.stringify({
          user_id: userId,
          last_message: compactMessageContent(latest.content),
          last_direction: latest.direction,
          last_at: latest.created_at,
        }),
      )
    }

    return updated
  }
  async getMsgs(userId, limit = 50, offset = 0) {
    const msgs = (await Promise.all((await kvListAll(this.kv, `msg:${userId}:`)).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean)
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return msgs.slice(offset, offset + limit)
  }
  async getMsgsSince(userId, since, limit = 50) {
    const msgs = await this.getMsgs(userId, Number.MAX_SAFE_INTEGER, 0)
    return msgs.filter(msg => String(msg?.created_at || '') > since).slice(0, limit)
  }
  async getRecentConvs(limit = 40) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 40), 200)
    const keys = await kvListAll(this.kv, 'recent:')
    // 只取最近一批 key 对应记录，避免全量 get 用户详情后再截断
    const rawConvs = (await Promise.all(keys.map(async k => {
      const d = await this.kv.get(k.name)
      if (!d) return null
      try { return JSON.parse(d) } catch { return null }
    }))).filter(Boolean)
    rawConvs.sort((a, b) => new Date(b.last_at) - new Date(a.last_at))
    const top = rawConvs.slice(0, safeLimit)
    const convs = await Promise.all(top.map(async c => {
      const u = await this.getUser(c.user_id)
      return { ...c, ...(u || {}) }
    }))
    return convs
  }
  async getRecentConvsSince(since, limit = 40) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 40), 200)
    // 多取一些再过滤，避免 since 过滤后不足
    const convs = await this.getRecentConvs(Math.min(safeLimit * 3, 200))
    return convs.filter(conv => String(conv?.last_at || '') > since).slice(0, safeLimit)
  }
  async getAllMsgsRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'msg:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean)
  }
  async deleteUserMsgs(userId) {
    const keys = await kvListAll(this.kv, `msg:${userId}:`)
    await Promise.all(keys.map(k => this.kv.delete(k.name)))
    await this.kv.delete(`recent:${userId}`)
    _invalidateListsContaining('msg:')
    _invalidateListsContaining('recent:')
  }
  async clearUserThread(userId) {
    const u = await this.getUser(userId)
    if (u) {
      if (u.thread_id) await this.kv.delete(`thread:${u.thread_id}`)
      u.thread_id = null
      await this.kv.put(`user:${userId}`, JSON.stringify(u))
      this._cacheSet(`user:${userId}`, u)
    }
    _invalidateListsContaining('user:')
  }

  async deleteUser(userId) {
    const uid = Number(userId)
    if (!Number.isFinite(uid)) return false

    const u = await this.getUser(uid)
    if (!u) return false

    await this.deleteUserMsgs(uid).catch(() => {})
    await this.clearUserThread(uid).catch(() => {})
    await this.removeFromWhitelist(uid).catch(() => {})

    if (u.username) await this.kv.delete(`username:${String(u.username).toLowerCase()}`).catch(() => {})
    await this.kv.delete(`user:${uid}`).catch(() => {})

    this._cacheDelete(`user:${uid}`)
    _invalidateListsContaining('user:')
    _invalidateListsContaining('username:')
    return true
  }
  async getAllRecentRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'recent:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean)
  }

  // Verification
  async setVerify(userId, data, ttlSeconds = 300) {
    const ttl = Math.max(60, ttlSeconds) // CF KV minimum TTL is 60s
    const rec = { user_id: userId, attempts: 0, expires_at: Date.now() + ttl * 1000, ...data }
    await this.kv.put(`verify:${userId}`, JSON.stringify(rec), { expirationTtl: ttl + 30 }) // +30s buffer for timeout cleanup
  }
  async getVerify(userId) { const d = await this.kv.get(`verify:${userId}`); return d ? JSON.parse(d) : null }
  async incVerify(userId) {
    const v = await this.getVerify(userId)
    if (v) {
      v.attempts++
      const ttl = Math.max(60, Math.floor((v.expires_at - Date.now()) / 1000))
      await this.kv.put(`verify:${userId}`, JSON.stringify(v), { expirationTtl: ttl })
    }
  }
  async delVerify(userId) { await this.kv.delete(`verify:${userId}`).catch(() => {}) }

  // Stats — 优先读缓存计数器，避免每次全量 list+get
  async _readStatsCache() {
    try {
      const raw = await this.kv.get('stats:cache')
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return null
      // 缓存 30s 内可直接返回
      if (Date.now() - (Number(data.updatedAt) || 0) > 30000) return null
      return {
        totalUsers: Number(data.totalUsers) || 0,
        blockedUsers: Number(data.blockedUsers) || 0,
        totalMessages: Number(data.totalMessages) || 0,
        todayMessages: Number(data.todayMessages) || 0,
      }
    } catch {
      return null
    }
  }

  async _writeStatsCache(stats) {
    const today = new Date().toISOString().slice(0, 10)
    const payload = {
      ...stats,
      day: today,
      updatedAt: Date.now(),
    }
    await this.kv.put('stats:cache', JSON.stringify(payload)).catch(() => {})
  }

  async getStats() {
    const cached = await this._readStatsCache()
    if (cached) return cached

    const [userKeys, msgKeys] = await Promise.all([kvListAll(this.kv, 'user:'), kvListAll(this.kv, 'msg:')])
    // 分批 get，避免一次拉爆
    let blockedCount = 0
    let verifiedCount = 0
    const BATCH = 50
    for (let i = 0; i < userKeys.length; i += BATCH) {
      const slice = userKeys.slice(i, i + BATCH)
      const userData = await Promise.all(slice.map(k => this.kv.get(k.name)))
      for (const d of userData) {
        if (!d) continue
        try {
          const u = JSON.parse(d)
          if (u.is_verified) verifiedCount++
          if (u.is_blocked && u.is_verified) blockedCount++
        } catch { /* noop */ }
      }
    }
    const today = new Date().toISOString().slice(0, 10)
    let todayMsgs = 0
    for (const k of msgKeys) {
      const ts = parseInt(k.name.split(':')[2]?.split('_')[0], 10)
      if (!isNaN(ts) && new Date(ts).toISOString().slice(0, 10) === today) todayMsgs++
    }
    const stats = { totalUsers: verifiedCount, blockedUsers: blockedCount, totalMessages: msgKeys.length, todayMessages: todayMsgs }
    await this._writeStatsCache(stats)
    return stats
  }

  // Web users
  async webUserCount() { return (await kvListAll(this.kv, 'webuser:')).length }
  /**
   * @param {string} username
   * @param {string} passwordHash
   * @param {{ isAdmin?: boolean }} [opts] 默认非管理员；bootstrap/正式注册需显式 isAdmin:true
   */
  async createWebUser(username, passwordHash, opts = {}) {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
    const isAdmin = opts?.isAdmin === true || opts?.isAdmin === 1 || opts?.isAdmin === '1'
    const user = {
      id,
      username,
      password_hash: passwordHash,
      totp_secret: null,
      totp_enabled: 0,
      is_admin: isAdmin ? 1 : 0,
      created_at: new Date().toISOString(),
    }
    await this.kv.put(`webuser:${username.toLowerCase()}`, JSON.stringify(user))
    await this.kv.put(`webuser_id:${id}`, JSON.stringify(user))
    _invalidateListsContaining('webuser:')
    _invalidateListsContaining('webuser_id:')
    return user
  }

  async setWebUserAdmin(id, isAdmin) {
    const u = await this.getWebUserById(id)
    if (!u) return null
    u.is_admin = isAdmin ? 1 : 0
    await this._saveWebUser(u)
    return u
  }
  async getWebUser(username) { const d = await this.kv.get(`webuser:${username.toLowerCase()}`); return d ? JSON.parse(d) : null }
  async getWebUserById(id) { const d = await this.kv.get(`webuser_id:${id}`); return d ? JSON.parse(d) : null }
  async updateWebUserPassword(id, hash) {
    const u = await this.getWebUserById(id)
    if (u) { u.password_hash = hash; await this._saveWebUser(u) }
  }
  async updateWebUserUsername(id, newUsername) {
    const u = await this.getWebUserById(id)
    if (!u) return
    await this.kv.delete(`webuser:${u.username.toLowerCase()}`)
    u.username = newUsername
    await this._saveWebUser(u)
  }
  async setWebUserTotp(id, secret, enabled) {
    const u = await this.getWebUserById(id)
    if (u) { u.totp_secret = secret; u.totp_enabled = enabled ? 1 : 0; await this._saveWebUser(u) }
  }
  async _saveWebUser(u) {
    await this.kv.put(`webuser:${u.username.toLowerCase()}`, JSON.stringify(u))
    await this.kv.put(`webuser_id:${u.id}`, JSON.stringify(u))
    _invalidateListsContaining('webuser:')
    _invalidateListsContaining('webuser_id:')
  }
  async getAllWebUsersRaw() {
    return (await Promise.all((await kvListAll(this.kv, 'webuser_id:')).map(k => this.kv.get(k.name).then(d => d ? JSON.parse(d) : null)))).filter(Boolean)
  }

  async clearAppDataPreserveWebUsers(activeDb = 'kv') {
    const prefixes = [
      'setting:',
      'user:',
      'username:',
      'whitelist:',
      'msg:',
      'recent:',
      'thread:',
      'verify:',
      'pending:',
      'pending_appeal:',
      'captcha_render:',
      'sess:',
      'dedupe:',
      'lock:user:',
      'lock:thread:',
      'stats:',
    ]

    for (const prefix of prefixes) {
      const keys = await kvListAll(this.kv, prefix)
      await Promise.all(keys.map(k => this.kv.delete(k.name).catch(() => {})))
    }

    await this.setSetting('ACTIVE_DB', activeDb)
    this.cache.clear()
    _listCache.clear()
  }

  /** 清空全部业务数据 + Web 登录账号（全量导入时使用） */
  async clearAppDataIncludingWebUsers(activeDb = 'kv') {
    await this.clearAppDataPreserveWebUsers(activeDb)
    for (const prefix of ['webuser:', 'webuser_id:', 'auth:session_epoch:', 'auth:bootstrap:', 'auth:rl:', 'sess_user:']) {
      const keys = await kvListAll(this.kv, prefix)
      await Promise.all(keys.map(k => this.kv.delete(k.name).catch(() => {})))
    }
    // 兼容旧 bootstrap marker
    await this.kv.delete('auth:has_default_admin').catch(() => {})
    await this.kv.delete('auth:bootstrap:v2').catch(() => {})
    await this.setSetting('ACTIVE_DB', activeDb)
    this.cache.clear()
    _listCache.clear()
  }
}
