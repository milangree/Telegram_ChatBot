import { DEFAULT_SETTINGS } from './db-settings.js'

const AUTO_REPAIR_INTERVAL_MS = 10 * 60 * 1000
let localAutoRepairAt = 0

export async function resolveActiveDb({ kv, d1Store, hyperdriveStore }) {
  // Prefer Hyperdrive marker when Hyperdrive is bound (strongly consistent).
  if (hyperdriveStore) {
    try {
      await hyperdriveStore.initSchema()
      const fromHyperdrive = await hyperdriveStore.getSetting('ACTIVE_DB')
      if (fromHyperdrive === 'kv' || fromHyperdrive === 'd1' || fromHyperdrive === 'hyperdrive') return fromHyperdrive
    } catch (e) {
      console.error('resolve active db from Hyperdrive failed:', e)
    }
  }

  // Prefer D1 marker when D1 is bound (strongly consistent).
  if (d1Store) {
    try {
      await d1Store.initSchema()
      const fromD1 = await d1Store.getSetting('ACTIVE_DB')
      if (fromD1 === 'kv' || fromD1 === 'd1' || fromD1 === 'hyperdrive') return fromD1
    } catch (e) {
      console.error('resolve active db from D1 failed:', e)
    }
  }

  // Fallback to KV marker (legacy / no D1 / no Hyperdrive).
  const fromKv = await kv.get('config:active_db')
  if (fromKv === 'kv' || fromKv === 'd1' || fromKv === 'hyperdrive') return fromKv

  return 'kv'
}

export async function autoRepairDb({ kv, kvStore, d1Store, hyperdriveStore }, force = false) {
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

    // Initialize Hyperdrive schema
    if (hyperdriveStore) {
      await hyperdriveStore.initSchema()
    }

    for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
      const vKv = await kvStore.getSetting(key)
      if (vKv === null) await kvStore.setSetting(key, defVal)
      if (d1Store) {
        const vD1 = await d1Store.getSetting(key)
        if (vD1 === null) await d1Store.setSetting(key, defVal)
      }
      if (hyperdriveStore) {
        const vHd = await hyperdriveStore.getSetting(key)
        if (vHd === null) await hyperdriveStore.setSetting(key, defVal)
      }
    }

    if (d1Store) {
      await d1Store.exec('UPDATE users SET is_verified=COALESCE(is_verified,0), is_blocked=COALESCE(is_blocked,0), is_permanent_block=COALESCE(is_permanent_block,0)')
      await d1Store.exec('DELETE FROM thread_map WHERE user_id NOT IN (SELECT user_id FROM users)')
      await d1Store.exec('INSERT OR REPLACE INTO thread_map(thread_id,user_id) SELECT thread_id,user_id FROM users WHERE thread_id IS NOT NULL')
    }

    // Hyperdrive: ensure data consistency
    if (hyperdriveStore) {
      if (hyperdriveStore.dbType === 'postgres') {
        await hyperdriveStore.exec(
          "UPDATE users SET is_verified=COALESCE(is_verified,0), is_blocked=COALESCE(is_blocked,0), is_permanent_block=COALESCE(is_permanent_block,0) WHERE is_verified IS NULL OR is_blocked IS NULL OR is_permanent_block IS NULL",
        )
        await hyperdriveStore.exec('DELETE FROM thread_map WHERE user_id NOT IN (SELECT user_id FROM users)')
        await hyperdriveStore.exec(
          'INSERT INTO thread_map(thread_id,user_id) SELECT thread_id,user_id FROM users WHERE thread_id IS NOT NULL ON CONFLICT(thread_id) DO UPDATE SET user_id=EXCLUDED.user_id',
        )
      } else {
        // MySQL variant
        await hyperdriveStore.exec(
          "UPDATE users SET is_verified=COALESCE(is_verified,0), is_blocked=COALESCE(is_blocked,0), is_permanent_block=COALESCE(is_permanent_block,0)",
        )
        await hyperdriveStore.exec('DELETE FROM thread_map WHERE user_id NOT IN (SELECT user_id FROM users)')
        await hyperdriveStore.exec(
          'INSERT INTO thread_map(thread_id,user_id) SELECT thread_id,user_id FROM users WHERE thread_id IS NOT NULL ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)',
        )
      }
    }

    if (!d1Store && !hyperdriveStore) {
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

export async function switchDbStore({ kv, kvStore, d1Store, hyperdriveStore }, target) {
  if (target !== 'kv' && target !== 'd1' && target !== 'hyperdrive') throw new Error('Invalid target')
  if ((target === 'd1') && !d1Store) throw new Error('D1 not bound')
  if (target === 'hyperdrive' && !hyperdriveStore) throw new Error('Hyperdrive not bound')

  // Keep KV marker for backward compatibility.
  await kv.put('config:active_db', target)

  // Keep settings marker in KV store too.
  await kvStore.setSetting('ACTIVE_DB', target).catch(() => {})

  // Keep settings marker in D1 as source-of-truth when available.
  if (d1Store) {
    await d1Store.initSchema()
    await d1Store.setSetting('ACTIVE_DB', target)
  }

  // Keep settings marker in Hyperdrive as source-of-truth when available.
  if (hyperdriveStore) {
    await hyperdriveStore.initSchema()
    await hyperdriveStore.setSetting('ACTIVE_DB', target)
  }
}

export async function syncDbData({ kvStore, d1Store, hyperdriveStore }, from, to) {
  const src = from === 'kv' ? kvStore : (from === 'd1' ? d1Store : hyperdriveStore)
  const dst = to === 'kv' ? kvStore : (to === 'd1' ? d1Store : hyperdriveStore)
  if (!src || !dst) throw new Error('Store not available')

  if (to === 'd1') await d1Store.initSchema()
  if (to === 'hyperdrive') await hyperdriveStore.initSchema()

  // Settings
  const settings = await src.getAllSettings()
  for (const [k, v] of Object.entries(settings)) await dst.setSetting(k, v)

  // Users
  for (const u of await src.getAllUsersRaw()) await dst.upsertUser(u)

  // Whitelist
  const wl = await src.getWhitelistRaw()
  for (const e of wl) {
    if (to === 'd1') {
      await d1Store.exec(
        'INSERT OR REPLACE INTO whitelist(user_id,reason,added_by,created_at) VALUES(?,?,?,?)',
        e.user_id, e.reason || '', e.added_by || '', e.created_at || new Date().toISOString(),
      )
    } else if (to === 'hyperdrive') {
      await hyperdriveStore.exec(
        'INSERT INTO whitelist(user_id,reason,added_by,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET reason=EXCLUDED.reason,added_by=EXCLUDED.added_by,created_at=EXCLUDED.created_at',
        e.user_id, e.reason || '', e.added_by || '', e.created_at || new Date().toISOString(),
      )
    } else {
      await kvStore.kv.put(`whitelist:${e.user_id}`, JSON.stringify({
        user_id: e.user_id,
        reason: e.reason || '',
        added_by: e.added_by || '',
        created_at: e.created_at || new Date().toISOString(),
      }))
    }
  }

  // Messages
  const msgs = await src.getAllMsgsRaw()
  if (to === 'd1') {
    for (const m of msgs) {
      await d1Store.exec(
        `INSERT OR IGNORE INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        m.id, m.user_id, m.direction, m.content || '', m.message_type || 'text',
        m.telegram_message_id || null, m.created_at || new Date().toISOString(),
      )
    }
  } else if (to === 'hyperdrive') {
    for (const m of msgs) {
      await hyperdriveStore.exec(
        `INSERT INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
        m.id, m.user_id, m.direction, m.content || '', m.message_type || 'text',
        m.telegram_message_id || null, m.created_at || new Date().toISOString(),
      )
    }
  } else {
    for (const m of msgs) {
      await kvStore.kv.put(`msg:${m.user_id}:${m.id}`, JSON.stringify({
        id: m.id,
        user_id: m.user_id,
        direction: m.direction,
        content: m.content || '',
        message_type: m.message_type || 'text',
        telegram_message_id: m.telegram_message_id || null,
        created_at: m.created_at || new Date().toISOString(),
      }))
    }
  }

  const recent = await src.getAllRecentRaw()
  if (to === 'd1') {
    for (const r of recent) {
      await d1Store.exec(
        'INSERT OR REPLACE INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES(?,?,?,?)',
        r.user_id, r.last_message || '', r.last_direction || 'incoming', r.last_at || new Date().toISOString(),
      )
    }
  } else if (to === 'hyperdrive') {
    for (const r of recent) {
      await hyperdriveStore.exec(
        'INSERT INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_direction=EXCLUDED.last_direction,last_at=EXCLUDED.last_at',
        r.user_id, r.last_message || '', r.last_direction || 'incoming', r.last_at || new Date().toISOString(),
      )
    }
  } else {
    for (const r of recent) {
      await kvStore.kv.put(`recent:${r.user_id}`, JSON.stringify({
        user_id: r.user_id,
        last_message: r.last_message || '',
        last_direction: r.last_direction || 'incoming',
        last_at: r.last_at || new Date().toISOString(),
      }))
    }
  }

  // Web users
  const wu = await src.getAllWebUsersRaw()
  if (to === 'd1') {
    for (const u of wu) {
      await d1Store.exec(
        `INSERT OR REPLACE INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        u.id, u.username, u.password_hash,
        u.totp_secret || null, u.totp_enabled ? 1 : 0,
        u.is_admin ? 1 : 0, u.created_at || new Date().toISOString(),
      )
    }
  } else if (to === 'hyperdrive') {
    for (const u of wu) {
      await hyperdriveStore.exec(
        `INSERT INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET
           username=EXCLUDED.username,
           password_hash=EXCLUDED.password_hash,
           totp_secret=EXCLUDED.totp_secret,
           totp_enabled=EXCLUDED.totp_enabled,
           is_admin=EXCLUDED.is_admin`,
        u.id, u.username, u.password_hash,
        u.totp_secret || null, u.totp_enabled ? 1 : 0,
        u.is_admin ? 1 : 0, u.created_at || new Date().toISOString(),
      )
    }
  } else {
    for (const u of wu) {
      await kvStore.kv.put(`webuser:${u.username.toLowerCase()}`, JSON.stringify(u))
      await kvStore.kv.put(`webuser_id:${u.id}`, JSON.stringify(u))
    }
  }
}
