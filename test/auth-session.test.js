import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession, getSession, bumpSessionEpoch, delSessionsForUser } from '../functions/_shared/auth.js'

class FakeKV {
  constructor() { this.data = new Map() }
  async get(key) { return this.data.get(key) ?? null }
  async put(key, value) { this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value)) }
  async delete(key) { this.data.delete(key) }
  async list({ prefix = '', limit = Infinity, cursor } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(prefix)).sort()
    const start = cursor ? Math.max(0, names.indexOf(cursor) + 1) : 0
    const page = names.slice(start, start + limit).map(name => ({ name }))
    const hasMore = start + page.length < names.length
    return { keys: page, list_complete: !hasMore, cursor: hasMore ? page.at(-1).name : null }
  }
}

test('session epoch invalidates old sessions', async () => {
  const kv = new FakeKV()
  const token = await createSession(kv, 'u1', 3600)
  assert.ok(await getSession(kv, token))
  await bumpSessionEpoch(kv, 'u1')
  assert.equal(await getSession(kv, token), null)
})

test('session cleanup scans indexed and legacy sessions', async () => {
  const kv = new FakeKV()
  const indexed = await createSession(kv, 'u2', 3600)
  const legacy = 'legacy-token'
  await kv.put(`sess:${legacy}`, JSON.stringify({ userId: 'u2', exp: Date.now() + 3600000 }))
  await delSessionsForUser(kv, 'u2')
  assert.equal(await kv.get(`sess:${indexed}`), null)
  assert.equal(await kv.get(`sess:${legacy}`), null)
})

test('session cleanup paginates beyond 200 entries', async () => {
  const kv = new FakeKV()
  for (let i = 0; i < 205; i++) {
    const token = `token-${String(i).padStart(3, '0')}`
    await kv.put(`sess:${token}`, JSON.stringify({ userId: 'u3', exp: Date.now() + 3600000 }))
    await kv.put(`sess_user:u3:${token}`, '1')
  }
  const removed = await delSessionsForUser(kv, 'u3')
  assert.equal(removed, 205)
  assert.equal((await kv.list({ prefix: 'sess:u3:' })).keys.length, 0)
  assert.equal((await kv.list({ prefix: 'sess:' })).keys.length, 0)
})
