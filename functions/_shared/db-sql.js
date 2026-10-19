// functions/_shared/db-sql.js
// SQL 导入导出 — 仅支持 AES-256-GCM 加密二进制包
// 格式：TGCB + ver(1) + flags(1) + salt(16) + iv(12) + ciphertext

const TGCB_BIN_MAGIC = new Uint8Array([0x54, 0x47, 0x43, 0x42]) // "TGCB"
const TGCB_BIN_VERSION = 0x01
const TGCB_BIN_FLAG_AES = 0x01

const BUSINESS_TABLES = {
  settings: ['key', 'value'],
  users: ['user_id', 'username', 'first_name', 'last_name', 'language_code', 'thread_id', 'is_verified', 'is_blocked', 'is_permanent_block', 'block_reason', 'blocked_by', 'created_at'],
  whitelist: ['user_id', 'reason', 'added_by', 'created_at'],
  messages: ['id', 'user_id', 'direction', 'content', 'message_type', 'telegram_message_id', 'created_at'],
  recent_convs: ['user_id', 'last_message', 'last_direction', 'last_at'],
  web_users: ['id', 'username', 'password_hash', 'totp_secret', 'totp_enabled', 'is_admin', 'created_at'],
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
    'DELETE FROM web_users;',
  ]
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

/** 加密 SQL 为二进制 AES-GCM 包 */
async function encryptSqlPayloadBinary(rawSql, password) {
  if (!password) throw new Error('AES password is required')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(password, salt)
  const data = new TextEncoder().encode(String(rawSql || ''))
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  const cipher = new Uint8Array(cipherBuffer)

  // header(6) + salt(16) + iv(12) + cipher
  const out = new Uint8Array(6 + 16 + 12 + cipher.length)
  out.set(TGCB_BIN_MAGIC, 0)
  out[4] = TGCB_BIN_VERSION
  out[5] = TGCB_BIN_FLAG_AES
  out.set(salt, 6)
  out.set(iv, 22)
  out.set(cipher, 34)
  return out
}

/** 解密二进制 AES-GCM 包 */
async function decryptSqlPayloadBinary(bytes, password) {
  if (!password) throw new Error('AES password is required')
  if (!(bytes instanceof Uint8Array) || bytes.length < 34 + 16) {
    throw new Error('Invalid binary SQL export payload')
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== TGCB_BIN_MAGIC[i]) throw new Error('Invalid binary SQL magic')
  }
  if (bytes[4] !== TGCB_BIN_VERSION) throw new Error('Unsupported binary SQL version')
  if (!(bytes[5] & TGCB_BIN_FLAG_AES)) throw new Error('Unsupported binary SQL flags')

  const salt = bytes.subarray(6, 22)
  const iv = bytes.subarray(22, 34)
  const data = bytes.subarray(34)
  const key = await deriveAesKey(password, salt)
  try {
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(new Uint8Array(plainBuffer))
  } catch {
    throw new Error('Invalid AES password or corrupted SQL payload')
  }
}

function isBinaryTgcb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) return false
  return bytes[0] === 0x54 && bytes[1] === 0x47 && bytes[2] === 0x43 && bytes[3] === 0x42
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * 解码导入载荷（仅支持 AES-256-GCM 加密二进制包）
 */
async function decodeSqlPayload(input, password = '') {
  if (input instanceof Uint8Array) {
    if (isBinaryTgcb(input)) return decryptSqlPayloadBinary(input, password)
    throw new Error('Invalid binary SQL payload')
  }

  const raw = String(input || '').trim()
  if (!raw) throw new Error('Empty SQL payload')

  // 尝试 base64 编码的二进制 .db 包
  try {
    const bytes = base64ToBytes(raw.replace(/\s+/g, ''))
    if (isBinaryTgcb(bytes)) return decryptSqlPayloadBinary(bytes, password)
  } catch { /* not base64 binary */ }

  throw new Error('Unsupported SQL format: use encrypted .db export')
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

const DEFAULT_SECRET_SETTING_KEYS = [
  'BOT_TOKEN',
  'WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'RECAPTCHA_SECRET_KEY',
  'RECAPTCHA_V3_SECRET_KEY',
  'HCAPTCHA_SECRET_KEY',
]

/**
 * 导出全量数据为加密二进制包（Uint8Array）
 * 打开文件即为乱码。password 必填。
 */
export async function exportBusinessDataSql(store, activeDb = 'kv', options = {}) {
  const password = String(options?.password || '')
  if (!password) throw new Error('AES password is required')

  const includeSecrets = options?.includeSecrets !== false
  const includeWebUsers = options?.includeWebUsers !== false
  const secretKeys = Array.isArray(options?.secretKeys) && options.secretKeys.length
    ? options.secretKeys
    : DEFAULT_SECRET_SETTING_KEYS
  const secretKeySet = new Set(secretKeys.map((k) => String(k)))

  const [settings, users, whitelist, messages, recentConvs, webUsers] = await Promise.all([
    store.getAllSettings(),
    store.getAllUsersRaw(),
    store.getWhitelistRaw(),
    store.getAllMsgsRaw(),
    store.getAllRecentRaw(),
    includeWebUsers && typeof store.getAllWebUsersRaw === 'function'
      ? store.getAllWebUsersRaw()
      : Promise.resolve([]),
  ])

  const settingsEntries = Object.entries(settings || {})
    .filter(([key]) => includeSecrets || !secretKeySet.has(String(key)))
    .map(([key, value]) => normalizeRecord('settings', { key, value }))

  const records = {
    settings: settingsEntries,
    users: (users || []).map((item) => normalizeRecord('users', item)),
    whitelist: (whitelist || []).map((item) => normalizeRecord('whitelist', item)),
    messages: (messages || []).map((item) => normalizeRecord('messages', item)),
    recent_convs: (recentConvs || []).map((item) => normalizeRecord('recent_convs', item)),
    web_users: includeWebUsers
      ? (webUsers || []).map((item) => normalizeRecord('web_users', item))
      : [],
  }

  const plainSql = buildPlainSqlFromRecords(records, activeDb)
  return encryptSqlPayloadBinary(plainSql, password)
}

/**
 * 解析导入载荷（仅支持 AES-256-GCM 加密二进制包）
 */
export async function parseBusinessSql(sqlInput, options = {}) {
  const decodedSql = await decodeSqlPayload(sqlInput, String(options?.password || ''))
  const records = {
    settings: [],
    users: [],
    whitelist: [],
    messages: [],
    recent_convs: [],
    web_users: [],
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

  for (const item of records.web_users || []) {
    if (!item?.id || !item?.username) continue
    const user = {
      id: item.id,
      username: item.username,
      password_hash: item.password_hash || '',
      totp_secret: item.totp_secret ?? null,
      totp_enabled: item.totp_enabled ? 1 : 0,
      is_admin: item.is_admin ? 1 : 0,
      created_at: item.created_at || new Date().toISOString(),
    }
    await kvStore.kv.put(`webuser:${String(user.username).toLowerCase()}`, JSON.stringify(user))
    await kvStore.kv.put(`webuser_id:${user.id}`, JSON.stringify(user))
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

  for (const item of records.web_users || []) {
    if (!item?.id || !item?.username) continue
    await d1Store.exec(
      `INSERT OR REPLACE INTO web_users(id,username,password_hash,totp_secret,totp_enabled,is_admin,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      item.id,
      item.username,
      item.password_hash || '',
      item.totp_secret ?? null,
      item.totp_enabled ? 1 : 0,
      item.is_admin ? 1 : 0,
      item.created_at || new Date().toISOString(),
    )
  }
}

/**
 * 导入数据到指定存储后端（仅支持 AES-256-GCM 加密包）
 */
export async function importBusinessDataSql(options = {}) {
  const {
    sqlText = '',
    target = 'kv',
    kvStore = null,
    d1Store = null,
    hyperdriveStore = null,
    password = '',
    clearFn = null,
    snapshotStore = null,
  } = options

  if (!sqlText) throw new Error('SQL payload is required')
  if (!password) throw new Error('AES password is required for encrypted export')

  const records = await parseBusinessSql(sqlText, { password })

  // 清空现有数据
  if (clearFn) await clearFn()

  // 恢复到目标存储
  if (target === 'kv' && kvStore) {
    await restoreToKv(kvStore, records)
  } else if (target === 'd1' && d1Store) {
    await restoreToD1(d1Store, records)
  } else if (target === 'hyperdrive' && hyperdriveStore) {
    // Hyperdrive 使用与 D1 相同的 SQL 语法
    await restoreToD1(hyperdriveStore, records)
  } else {
    throw new Error(`Unknown target storage: ${target}`)
  }

  return records
}
