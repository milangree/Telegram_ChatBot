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

export async function exportBusinessDataSql(store, activeDb = 'kv') {
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

export function parseBusinessSql(sqlText) {
  const records = {
    settings: [],
    users: [],
    whitelist: [],
    messages: [],
    recent_convs: [],
  }

  for (const line of String(sqlText || '').split(/\r?\n/)) {
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

export async function importBusinessDataSql({ sqlText, target, kvStore, d1Store }) {
  const records = parseBusinessSql(sqlText)
  const hasAnyRecord = Object.values(records).some((items) => items.length > 0)

  if (!hasAnyRecord) {
    throw new Error('SQL file does not contain any importable TGCB business records')
  }

  if (target === 'd1') {
    if (!d1Store) throw new Error('D1 store is not available')
    await restoreToD1(d1Store, records)
    return
  }

  await restoreToKv(kvStore, records)
}
