// functions/_shared/db.js
import { DEFAULT_SETTINGS } from './db-settings.js'
import { KVStore } from './db-kv.js'
import { D1Store } from './db-d1.js'
import { HyperdriveStore } from './db-hyperdrive.js'
import { resolveActiveDb, autoRepairDb, switchDbStore, syncDbData } from './db-routing.js'
import { ensureAdminInitializedOnce, finalizeInitialRegistration } from './admin-bootstrap.js'

export { DEFAULT_SETTINGS }

export class DB {
  constructor(kv, d1 = null, hyperdrive = null) {
    this.kv = kv
    this.d1 = d1
    this.hyperdrive = hyperdrive
    this._kv = new KVStore(kv)
    this._d1 = d1 ? new D1Store(d1) : null
    this._hyperdrive = hyperdrive ? new HyperdriveStore(hyperdrive) : null
    this._activeStore = null
  }

  async _resolveActiveDb() {
    return resolveActiveDb({ kv: this.kv, d1Store: this._d1, hyperdriveStore: this._hyperdrive })
  }

  async getActiveDb() {
    return this._resolveActiveDb()
  }

  async _store() {
    if (this._activeStore) return this._activeStore
    const active = await this._resolveActiveDb()
    if (active === 'hyperdrive' && this._hyperdrive) {
      this._activeStore = this._hyperdrive
    } else if (active === 'd1' && this._d1) {
      this._activeStore = this._d1
    } else {
      this._activeStore = this._kv
    }
    return this._activeStore
  }

  /**
   * 自动修复（节流）：
   * - 确保 D1 / Hyperdrive schema 完整
   * - 补齐缺失默认设置
   * - 修复部分数据一致性（thread_map / users 字段）
   */
  async autoRepair(force = false, preferredDb = null) {
    await autoRepairDb({ kv: this.kv, kvStore: this._kv, d1Store: this._d1, hyperdriveStore: this._hyperdrive }, force, preferredDb)
  }

  // Verification always uses KV (ephemeral data, TTL support)
  async setVerify(userId, data, ttlSeconds = 300) { return this._kv.setVerify(userId, data, ttlSeconds) }
  async getVerify(userId) { return this._kv.getVerify(userId) }
  async incVerify(userId) { return this._kv.incVerify(userId) }
  async delVerify(userId) { return this._kv.delVerify(userId) }

  // All other methods delegate to active store
  async getSetting(key) { return (await this._store()).getSetting(key) }
  async setSetting(key, val) { return (await this._store()).setSetting(key, val) }
  async getAllSettings() { return (await this._store()).getAllSettings() }

  async getUser(id) { return (await this._store()).getUser(id) }
  async upsertUser(u) { return (await this._store()).upsertUser(u) }
  async setUserThread(uid, tid) { return (await this._store()).setUserThread(uid, tid) }
  async getUserByThread(tid) { return (await this._store()).getUserByThread(tid) }
  async setUserVerified(uid, v) { return (await this._store()).setUserVerified(uid, v) }
  async blockUser(uid, r, by, perm) { return (await this._store()).blockUser(uid, r, by, perm) }
  async unblockUser(uid) { return (await this._store()).unblockUser(uid) }
  async updateUsername(uid, name) { return (await this._store()).updateUsername(uid, name) }
  async searchUsers(q, lim) { return (await this._store()).searchUsers(q, lim) }
  async getAllUsers(p, ps) { return (await this._store()).getAllUsers(p, ps) }
  async getBlockedUsers(p, ps) { return (await this._store()).getBlockedUsers(p, ps) }
  async getNormalUsers(p, ps) { return (await this._store()).getNormalUsers(p, ps) }

  async isWhitelisted(uid) { return (await this._store()).isWhitelisted(uid) }
  async addToWhitelist(uid, r, by) { return (await this._store()).addToWhitelist(uid, r, by) }
  async removeFromWhitelist(uid) { return (await this._store()).removeFromWhitelist(uid) }
  async getWhitelist(p, ps) { return (await this._store()).getWhitelist(p, ps) }
  async getAllUsersRaw() { return (await this._store()).getAllUsersRaw() }
  async getWhitelistRaw() { return (await this._store()).getWhitelistRaw() }

  async addMsg(opts) { return (await this._store()).addMsg(opts) }
  async updateMsgContentByTelegramMessageId(opts) { return (await this._store()).updateMsgContentByTelegramMessageId(opts) }
  async getMsgs(uid, lim, off) { return (await this._store()).getMsgs(uid, lim, off) }
  async getMsgsSince(uid, since, lim) { return (await this._store()).getMsgsSince(uid, since, lim) }
  async getRecentConvs(lim) { return (await this._store()).getRecentConvs(lim) }
  async getRecentConvsSince(since, lim) { return (await this._store()).getRecentConvsSince(since, lim) }
  async getAllMsgsRaw() { return (await this._store()).getAllMsgsRaw() }
  async getAllRecentRaw() { return (await this._store()).getAllRecentRaw() }
  async deleteUserMsgs(uid) { return (await this._store()).deleteUserMsgs(uid) }
  async clearUserThread(uid) { return (await this._store()).clearUserThread(uid) }
  async deleteUser(uid) { return (await this._store()).deleteUser(uid) }
  async getStats() { return (await this._store()).getStats() }

  async webUserCount() { return (await this._store()).webUserCount() }
  async createWebUser(u, h) { return (await this._store()).createWebUser(u, h) }
  async getWebUser(u) { return (await this._store()).getWebUser(u) }
  async getWebUserById(id) { return (await this._store()).getWebUserById(id) }
  async updateWebUserPassword(id, h) { return (await this._store()).updateWebUserPassword(id, h) }
  async updateWebUserUsername(id, u) { return (await this._store()).updateWebUserUsername(id, u) }
  async setWebUserTotp(id, s, e) { return (await this._store()).setWebUserTotp(id, s, e) }

  async clearAppDataPreserveWebUsers() {
    const active = await this.getActiveDb()

    await this._kv.clearAppDataPreserveWebUsers(active)
    if (this._d1) await this._d1.clearAppDataPreserveWebUsers(active)
    if (this._hyperdrive) await this._hyperdrive.clearAppDataPreserveWebUsers(active)

    this._activeStore = null
  }

  /** Switch active DB and optionally sync data. */
  async switchDb(target) {
    await switchDbStore({ kv: this.kv, kvStore: this._kv, d1Store: this._d1, hyperdriveStore: this._hyperdrive }, target)
    this._activeStore = null // reset cache
  }

  /** Full sync from one store to another. Idempotent — safe to call multiple times. */
  async syncData(from, to) {
    await syncDbData({ kvStore: this._kv, d1Store: this._d1, hyperdriveStore: this._hyperdrive }, from, to)
  }

  /**
   * On first boot, create the fallback admin/admins account.
   * Once a real user registers (registerWebUser is called), we disable the
   * fallback account so it can never be used again.
   */
  async getAllWebUsersRaw() { return (await this._store()).getAllWebUsersRaw() }

  async ensureDefaultAdmin(env = {}) {
    return ensureAdminInitializedOnce({ db: this, kv: this.kv, env })
  }

  async disableDefaultAdmin(registeredUserId = null) {
    return finalizeInitialRegistration({ db: this, kv: this.kv, registeredUserId })
  }

}
