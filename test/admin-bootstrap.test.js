import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureAdminInitialized, registerInitialAdmin, BootstrapError, getBootstrapStatus } from '../functions/_shared/admin-bootstrap.js'
import { verifyPw } from '../functions/_shared/auth.js'

class FakeKV {
  constructor() { this.data = new Map() }
  async get(key) { return this.data.get(key) ?? null }
  async put(key, value) { this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value)) }
  async delete(key) { this.data.delete(key) }
  async list({ prefix = '' } = {}) { return { keys: [...this.data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null } }
}

class FakeDB {
  constructor() { this.users = []; this.passwordUpdates = 0 }
  async webUserCount() { return this.users.length }
  async createWebUser(username, password_hash) {
    const user = { id: `id-${this.users.length + 1}`, username, password_hash, is_admin: 1, totp_enabled: 0 }
    this.users.push(user)
    return user
  }
  async getWebUser(username) { return this.users.find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null }
  async getWebUserById(id) { return this.users.find(u => u.id === id) || null }
  async getAllWebUsersRaw() { return [...this.users] }
  async updateWebUserPassword(id, password_hash) {
    const user = await this.getWebUserById(id)
    if (user) { user.password_hash = password_hash; this.passwordUpdates++ }
  }
}

test('rejects a short configured admin password', async () => {
  const kv = new FakeKV()
  const db = new FakeDB()
  await assert.rejects(
    ensureAdminInitialized({ db, kv, env: { ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: '12345' } }),
    BootstrapError,
  )
  assert.equal(db.users.length, 0)
})

test('persists custom bootstrap id and disables it after registration', async () => {
  const kv = new FakeKV()
  const db = new FakeDB()
  await ensureAdminInitialized({ db, kv, env: { ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: 'secure-password' } })
  const bootstrap = JSON.parse(await kv.get('auth:bootstrap:v2'))
  assert.equal(bootstrap.defaultAdminId, 'id-1')
  assert.equal((await getBootstrapStatus({ db, kv })).needsRegistration, true)

  const registered = await registerInitialAdmin({
    db,
    kv,
    username: 'real-admin',
    password: 'another-password',
    bootstrapUserId: bootstrap.defaultAdminId,
  })
  assert.equal(registered.username, 'real-admin')
  assert.equal((await db.getWebUserById('id-1')).password_hash.startsWith('!!disabled:'), true)
  assert.equal((await getBootstrapStatus({ db, kv })).needsRegistration, false)
})

test('cannot register without the bootstrap user identity', async () => {
  const kv = new FakeKV()
  const db = new FakeDB()
  await ensureAdminInitialized({ db, kv, env: { ADMIN_PASSWORD: 'secure-password' } })
  const bootstrap = JSON.parse(await kv.get('auth:bootstrap:v2'))
  await assert.rejects(
    registerInitialAdmin({ db, kv, username: 'attacker', password: 'secure-password', bootstrapUserId: 'wrong-id' }),
    BootstrapError,
  )
})

test('does not rewrite a pending password when it already matches', async () => {
  const kv = new FakeKV()
  const db = new FakeDB()
  await ensureAdminInitialized({ db, kv, env: { ADMIN_USERNAME: 'ops2', ADMIN_PASSWORD: 'secure-password' } })
  const before = db.passwordUpdates
  await ensureAdminInitialized({ db, kv, env: { ADMIN_USERNAME: 'ops2', ADMIN_PASSWORD: 'secure-password' } })
  assert.equal(db.passwordUpdates, before)
  assert.equal(await verifyPw('secure-password', (await db.getWebUser('ops2')).password_hash), true)
})
