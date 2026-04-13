import { DEFAULT_SETTINGS } from './db-settings.js'

const AUTO_REPAIR_INTERVAL_MS = 10 * 60 * 1000
let localAutoRepairAt = 0

export async function resolveActiveDb({ kv, d1Store }) {
  // Prefer D1 marker when D1 is bound (strongly consistent).
  if (d1Store) {
    try {
      await d1Store.initSchema()
      const fromD1 = await d1Store.getSetting('ACTIVE_DB')
      if (fromD1 === 'kv' || fromD1 === 'd1') return fromD1
    } catch (e) {
      console.error('resolve active db from D1 failed:', e)
    }
  }

  // Fallback to KV marker (legacy / no D1).
  const fromKv = await kv.get('config:active_db')
  if (fromKv === 'kv' || fromKv === 'd1') return fromKv

  return 'kv'
}

export async function autoRepairDb({ kv, kvStore, d1Store }, force = false) {
  const now = Date.now()
  if (!force && now - localAutoRepairAt < 60000) return
  localAutoRepairAt = now

  try {
    if (!force) {
      const last = await kv.get('db:auto_repair:last')
      if (last && now - Number(last) < AUTO_REPAIR_INTERVAL_MS) return
    }

    if (d1Store) {
      await d1Store.initSchema()
    }

    for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
      const vKv = await kvStore.getSetting(key)
      if (vKv === null) await kvStore.setSetting(key, defVal)
      if (d1Store) {
        const vD1 = await d1Store.getSetting(key)
        if (vD1 === null) await d1Store.setSetting(key, defVal)
      }
    }

    if (d1Store) {
      await d1Store.exec('UPDATE users SET is_verified=COALESCE(is_verified,0), is_blocked=COALESCE(is_blocked,0), is_permanent_block=COALESCE(is_permanent_block,0)')
      await d1Store.exec('DELETE FROM thread_map WHERE user_id NOT IN (SELECT user_id FROM users)')
      await d1Store.exec('INSERT OR REPLACE INTO thread_map(thread_id,user_id) SELECT thread_id,user_id FROM users WHERE thread_id IS NOT NULL')
    } else {
      const users = await kvStore.getAllUsersRaw()
      for (const u of users) {
        if (u?.thread_id) await kv.put(`thread:${u.thread_id}`, String(u.user_id))
      }
    }

    await kv.put('db:auto_repair:last', String(now), { expirationTtl: 86400 })
  } catch (e) {
    console.error('autoRepair:', e)
  }
}

export async function switchDbStore({ kv, kvStore, d1Store }, target) {
  if (target !== 'kv' && target !== 'd1') throw new Error('Invalid target')
  if (target === 'd1' && !d1Store) throw new Error('D1 not bound')

  // Keep KV marker for backward compatibility.
  await kv.put('config:active_db', target)

  // Keep settings marker in KV store too.
  await kvStore.setSetting('ACTIVE_DB', target).catch(() => {})

  // Keep settings marker in D1 as source-of-truth when available.
  if (d1Store) {
    await d1Store.initSchema()
    await d1Store.setSetting('ACTIVE_DB', target)
  }
}

export async function syncDbData({ kvStore, d1Store }, from, to) {
  const src = from === 'kv' ? kvStore : d1Store
  const dst = to === 'kv' ? kvStore : d1Store
  if (!src || !dst) throw new Error('Store not available')

  if (to === 'd1') await d1Store.initSchema()

  // Settings
  const settings = await src.getAllSettings()
  for (const [k, v] of Object.entries(settings)) await dst.setSetting(k, v)

  // Users (upsertUser uses ON CONFLICT / overwrite — safe)
  for (const u of await src.getAllUsersRaw()) await dst.upsertUser(u)

  // Whitelist: use INSERT OR REPLACE in D1, overwrite in KV
  const wl = await src.getWhitelistRaw()
  if (to === 'd1') {
    for (const e of wl) {
      await d1Store.exec(
        'INSERT OR REPLACE INTO whitelist(user_id,reason,added_by,created_at) VALUES(?,?,?,?)',
        e.user_id, e.reason || '', e.added_by || '', e.created_at || new Date().toISOString()
      )
    }
  } else {
    for (const e of wl) await kvStore.addToWhitelist(e.user_id, e.reason, e.added_by)
  }

  // Messages: INSERT OR IGNORE in D1 (keyed by id), overwrite in KV
  const msgs = await src.getAllMsgsRaw()
  if (to === 'd1') {
    for (const m of msgs) {
      await d1Store.exec(
        `INSERT OR IGNORE INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        m.id, m.user_id, m.direction, m.content || '', m.message_type || 'text',
        m.telegram_message_id || null, m.created_at || new Date().toISOString()
      )
    }
  } else {
    for (const m of msgs) await kvStore.addMsg(m)
  }

  // Web users — preserve original ID to avoid UNIQUE re-insert on repeated sync
  const wu = await src.getAllWebUsersRaw()
  if (to === 'd1') {
    for (const u of wu) {
      // INSERT OR REPLACE keeps the row idempotent on both username and id
      await d1Store.exec(
        `INSERT OR REPLACE INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        u.id, u.username, u.password_hash,
        u.totp_secret || null, u.totp_enabled ? 1 : 0,
        u.is_admin ? 1 : 0, u.created_at || new Date().toISOString()
      )
    }
  } else {
    for (const u of wu) {
      await kvStore.kv.put(`webuser:${u.username.toLowerCase()}`, JSON.stringify(u))
      await kvStore.kv.put(`webuser_id:${u.id}`, JSON.stringify(u))
    }
  }
}
