const TGCB_SQL_BASE64_PREFIX = '-- TGCB_SQL_BASE64 '
const TGCB_SQL_AES_PREFIX = '-- TGCB_SQL_AES256GCM '

const BUSINESS_TABLES = {
  settings: ['key', 'value'],
  users: ['user_id', 'username', 'first_name', 'last_name', 'language_code', 'thread_id', 'is_verified', 'is_blocked', 'is_permanent_block', 'block_reason', 'blocked_by', 'created_at'],
  whitelist: ['user_id', 'reason', 'added_by', 'created_at'],
  messages: ['id', 'user_id', 'direction', 'content', 'message_type', 'telegram_message_id', 'created_at'],
  recent_convs: ['user_id', 'last_message', 'last_direction', 'last_at'],
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function toSqlInsert(table, record) {
  const columns = BUSINESS_TABLES[table]
  const values = columns.map((column) => sqlValue(record?.[column]))
  return `INSERT INTO ${table}(${columns.join(', ')}) VALUES (${values.join(', ')});`
}

function toRecordComment(table, record) {
  return `-- TGCB_RECORD ${table} ${JSON.stringify(record)}`
}

function normalizeRecord(table, record) {
  const columns = BUSINESS_TABLES[table]
  return columns.reduce((acc, column) => {
    acc[column] = record?.[column] ?? null
    return acc
  }, {})
}

function buildDeleteStatements() {
  return [
    'DELETE FROM recent_convs;',
    'DELETE FROM messages;',
    'DELETE FROM whitelist;',
    'DELETE FROM users;',
    'DELETE FROM settings;',
  ]
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(String(str || ''))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToUtf8(payload) {
  const binary = atob(String(payload || ''))
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function deriveAesKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptSqlPayloadAes(rawSql, password) {
  if (!password) throw new Error('AES password is required')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(password, salt)
  const data = new TextEncoder().encode(String(rawSql || ''))
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  const cipher = new Uint8Array(cipherBuffer)

  const payload = {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 120000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cipher),
  }

  return `${TGCB_SQL_AES_PREFIX}${utf8ToBase64(JSON.stringify(payload))}\n`
}

async function decryptSqlPayloadAes(wrappedSql, password) {
  if (!password) throw new Error('AES password is required for this SQL file')

  const payloadB64 = String(wrappedSql || '').trim().slice(TGCB_SQL_AES_PREFIX.length).trim()
  if (!payloadB64) throw new Error('Invalid AES SQL export payload')

  let payload
  try {
    payload = JSON.parse(base64ToUtf8(payloadB64))
  } catch {
    throw new Error('Invalid AES SQL payload format')
  }

  const salt = base64ToBytes(payload?.salt || '')
  const iv = base64ToBytes(payload?.iv || '')
  const data = base64ToBytes(payload?.data || '')

  const key = await deriveAesKey(password, salt)
  try {
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(new Uint8Array(plainBuffer))
  } catch {
    throw new Error('Invalid AES password or corrupted SQL payload')
  }
}

function decodeBase64WrappedSql(wrappedSql) {
  const payload = String(wrappedSql || '').trim().slice(TGCB_SQL_BASE64_PREFIX.length).trim()
  if (!payload) throw new Error('Invalid Base64 SQL export payload')
  return base64ToUtf8(payload)
}

async function decodeSqlByMode(sqlText, password = '') {
  const raw = String(sqlText || '').trim()
  if (raw.startsWith(TGCB_SQL_AES_PREFIX)) return decryptSqlPayloadAes(raw, password)
  if (raw.startsWith(TGCB_SQL_BASE64_PREFIX)) return decodeBase64WrappedSql(raw)
  return String(sqlText || '')
}

function buildPlainSqlFromRecords(records, activeDb) {
  const lines = [
    '-- Telegram_ChatBot Business Data SQL Export',
    `-- Source Storage: ${activeDb}`,
    '-- This file contains business data only and does not include WebUI login accounts.',
    'BEGIN TRANSACTION;',
    ...buildDeleteStatements(),
  ]

  for (const table of Object.keys(BUSINESS_TABLES)) {
    lines.push(`-- SECTION ${table}`)
    for (const record of records[table]) {
      lines.push(toRecordComment(table, record))
      lines.push(toSqlInsert(table, record))
    }
  }

  lines.push('COMMIT;')
  return lines.join('\n')
}

export async function exportBusinessDataSql(store, activeDb = 'kv', options = {}) {
  const mode = String(options?.mode || 'base64').toLowerCase()
  const password = String(options?.password || '')

  const [settings, users, whitelist, messages, recentConvs] = await Promise.all([
    store.getAllSettings(),
    store.getAllUsersRaw(),
    store.getWhitelistRaw(),
    store.getAllMsgsRaw(),
    store.getAllRecentRaw(),
  ])

  const records = {
    settings: Object.entries(settings || {}).map(([key, value]) => normalizeRecord('settings', { key, value })),
    users: (users || []).map((item) => normalizeRecord('users', item)),
    whitelist: (whitelist || []).map((item) => normalizeRecord('whitelist', item)),
    messages: (messages || []).map((item) => normalizeRecord('messages', item)),
    recent_convs: (recentConvs || []).map((item) => normalizeRecord('recent_convs', item)),
  }

  const plainSql = buildPlainSqlFromRecords(records, activeDb)

  if (mode === 'plain') return `${plainSql}\n`
  if (mode === 'aes') return encryptSqlPayloadAes(plainSql, password)
  return `${TGCB_SQL_BASE64_PREFIX}${utf8ToBase64(plainSql)}\n`
}

export async function parseBusinessSql(sqlText, options = {}) {
  const decodedSql = await decodeSqlByMode(sqlText, String(options?.password || ''))
  const records = {
    settings: [],
    users: [],
    whitelist: [],
    messages: [],
    recent_convs: [],
  }

  for (const line of String(decodedSql || '').split(/\r?\n/)) {
    const match = line.match(/^-- TGCB_RECORD ([a-z_]+) (.+)$/)
    if (!match) continue

    const [, table, payload] = match
    if (!Object.prototype.hasOwnProperty.call(records, table)) continue

    try {
      records[table].push(normalizeRecord(table, JSON.parse(payload)))
    } catch (error) {
      throw new Error(`Invalid SQL record payload for table "${table}": ${error.message}`)
    }
  }

  return records
}

async function restoreToKv(kvStore, records) {
  for (const item of records.settings) {
    await kvStore.setSetting(item.key, item.value ?? '')
  }

  for (const item of records.users) {
    await kvStore.kv.put(`user:${item.user_id}`, JSON.stringify(item))
    kvStore._cacheSet(`user:${item.user_id}`, item)
    if (item.username) await kvStore.kv.put(`username:${String(item.username).toLowerCase()}`, String(item.user_id))
    if (item.thread_id !== null && item.thread_id !== undefined && item.thread_id !== '') {
      await kvStore.kv.put(`thread:${item.thread_id}`, String(item.user_id))
    }
  }

  for (const item of records.whitelist) {
    await kvStore.kv.put(`whitelist:${item.user_id}`, JSON.stringify(item))
    kvStore._cacheSet(`whitelist:${item.user_id}`, JSON.stringify(item))
  }

  for (const item of records.messages) {
    await kvStore.kv.put(`msg:${item.user_id}:${item.id}`, JSON.stringify(item))
  }

  for (const item of records.recent_convs) {
    await kvStore.kv.put(`recent:${item.user_id}`, JSON.stringify(item))
  }
}

async function restoreToD1(d1Store, records) {
  await d1Store.initSchema()

  for (const item of records.settings) {
    await d1Store.exec('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', item.key, item.value ?? '')
  }

  for (const item of records.users) {
    await d1Store.exec(
      `INSERT OR REPLACE INTO users(user_id,username,first_name,last_name,language_code,thread_id,is_verified,is_blocked,is_permanent_block,block_reason,blocked_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      item.user_id,
      item.username,
      item.first_name,
      item.last_name,
      item.language_code,
      item.thread_id,
      item.is_verified ?? 0,
      item.is_blocked ?? 0,
      item.is_permanent_block ?? 0,
      item.block_reason,
      item.blocked_by,
      item.created_at,
    )

    if (item.thread_id !== null && item.thread_id !== undefined && item.thread_id !== '') {
      await d1Store.exec('INSERT OR REPLACE INTO thread_map(thread_id,user_id) VALUES(?,?)', item.thread_id, item.user_id)
    }
  }

  for (const item of records.whitelist) {
    await d1Store.exec(
      'INSERT OR REPLACE INTO whitelist(user_id,reason,added_by,created_at) VALUES(?,?,?,?)',
      item.user_id,
      item.reason,
      item.added_by,
      item.created_at,
    )
  }

  for (const item of records.messages) {
    await d1Store.exec(
      `INSERT OR REPLACE INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      item.id,
      item.user_id,
      item.direction,
      item.content,
      item.message_type,
      item.telegram_message_id,
      item.created_at,
    )
  }

  for (const item of records.recent_convs) {
    await d1Store.exec(
      'INSERT OR REPLACE INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES(?,?,?,?)',
      item.user_id,
      item.last_message,
      item.last_direction,
      item.last_at,
    )
  }
}

async function restoreToPostgres(hyperdriveStore, records) {
  await hyperdriveStore.initSchema()

  for (const item of records.settings) {
    await hyperdriveStore.exec(
      'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      item.key, item.value ?? '',
    )
  }

  for (const item of records.users) {
    await hyperdriveStore.exec(
      `INSERT INTO users(user_id,username,first_name,last_name,language_code,thread_id,is_verified,is_blocked,is_permanent_block,block_reason,blocked_by,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(user_id) DO UPDATE SET
         username=EXCLUDED.username,
         first_name=EXCLUDED.first_name,
         last_name=EXCLUDED.last_name,
         language_code=EXCLUDED.language_code,
         thread_id=EXCLUDED.thread_id,
         is_verified=EXCLUDED.is_verified,
         is_blocked=EXCLUDED.is_blocked,
         is_permanent_block=EXCLUDED.is_permanent_block,
         block_reason=EXCLUDED.block_reason,
         blocked_by=EXCLUDED.blocked_by,
         created_at=EXCLUDED.created_at`,
      item.user_id, item.username, item.first_name, item.last_name,
      item.language_code, item.thread_id, item.is_verified ?? 0,
      item.is_blocked ?? 0, item.is_permanent_block ?? 0,
      item.block_reason, item.blocked_by, item.created_at,
    )

    if (item.thread_id !== null && item.thread_id !== undefined && item.thread_id !== '') {
      await hyperdriveStore.exec(
        'INSERT INTO thread_map(thread_id,user_id) VALUES($1,$2) ON CONFLICT(thread_id) DO UPDATE SET user_id=EXCLUDED.user_id',
        item.thread_id, item.user_id,
      )
    }
  }

  for (const item of records.whitelist) {
    await hyperdriveStore.exec(
      'INSERT INTO whitelist(user_id,reason,added_by,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET reason=EXCLUDED.reason,added_by=EXCLUDED.added_by,created_at=EXCLUDED.created_at',
      item.user_id, item.reason, item.added_by, item.created_at,
    )
  }

  for (const item of records.messages) {
    await hyperdriveStore.exec(
      `INSERT INTO messages(id,user_id,direction,content,message_type,telegram_message_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
      item.id, item.user_id, item.direction, item.content,
      item.message_type, item.telegram_message_id, item.created_at,
    )
  }

  for (const item of records.recent_convs) {
    await hyperdriveStore.exec(
      'INSERT INTO recent_convs(user_id,last_message,last_direction,last_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_direction=EXCLUDED.last_direction,last_at=EXCLUDED.last_at',
      item.user_id, item.last_message, item.last_direction, item.last_at,
    )
  }
}

export async function importBusinessDataSql({ sqlText, target, kvStore, d1Store, hyperdriveStore, password = '' }) {
  const records = await parseBusinessSql(sqlText, { password })
  const hasAnyRecord = Object.values(records).some((items) => items.length > 0)

  if (!hasAnyRecord) {
    throw new Error('SQL file does not contain any importable TGCB business records')
  }

  if (target === 'hyperdrive') {
    if (!hyperdriveStore) throw new Error('Hyperdrive store is not available')
    await restoreToPostgres(hyperdriveStore, records)
    return
  }

  if (target === 'd1') {
    if (!d1Store) throw new Error('D1 store is not available')
    await restoreToD1(d1Store, records)
    return
  }

  await restoreToKv(kvStore, records)
}
