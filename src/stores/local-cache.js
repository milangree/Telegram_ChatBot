const CACHE_PREFIX = 'tgcb:cache:'

function getStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getFullKey(key) {
  return `${CACHE_PREFIX}${key}`
}

export function readLocalCache(key, { ttlMs = 0 } = {}) {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(getFullKey(key))
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      storage.removeItem(getFullKey(key))
      return null
    }

    const createdAt = Number(parsed.createdAt || 0)
    if (ttlMs > 0 && createdAt > 0 && Date.now() - createdAt > ttlMs) {
      storage.removeItem(getFullKey(key))
      return null
    }

    return parsed.value
  } catch {
    return null
  }
}

/** 禁止写入本地缓存的敏感字段（Bot Token / Captcha Secret 等） */
const SENSITIVE_CACHE_KEYS = new Set([
  'BOT_TOKEN',
  'WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'RECAPTCHA_SECRET_KEY',
  'RECAPTCHA_V3_SECRET_KEY',
  'HCAPTCHA_SECRET_KEY',
])

export function stripSensitiveSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const next = { ...value }
  for (const key of SENSITIVE_CACHE_KEYS) {
    if (key in next) delete next[key]
  }
  return next
}

export function writeLocalCache(key, value) {
  const storage = getStorage()
  if (!storage) return value

  try {
    // 设置相关缓存自动剥离密钥字段，避免 BOT_TOKEN 等落盘
    const safeValue = (typeof key === 'string' && key.includes('settings'))
      ? stripSensitiveSettings(value)
      : value
    storage.setItem(getFullKey(key), JSON.stringify({
      createdAt: Date.now(),
      value: safeValue,
    }))
  } catch {
    // noop
  }

  return value
}

export function removeLocalCache(key) {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(getFullKey(key))
  } catch {
    // noop
  }
}

export function clearLocalCache() {
  const storage = getStorage()
  if (!storage) return

  try {
    const keys = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // noop
  }
}

export function getLatestTimestamp(list, field) {
  let latest = ''
  for (const item of Array.isArray(list) ? list : []) {
    const value = String(item?.[field] || '')
    if (value && (!latest || value > latest)) latest = value
  }
  return latest
}

export function mergeByKey(currentList, nextList, key = 'id', sortFn = null) {
  const map = new Map()

  for (const item of Array.isArray(currentList) ? currentList : []) {
    if (item?.[key] !== undefined && item?.[key] !== null) map.set(String(item[key]), item)
  }

  for (const item of Array.isArray(nextList) ? nextList : []) {
    if (item?.[key] !== undefined && item?.[key] !== null) {
      map.set(String(item[key]), { ...(map.get(String(item[key])) || {}), ...item })
    }
  }

  const merged = Array.from(map.values())
  if (typeof sortFn === 'function') merged.sort(sortFn)
  return merged
}

export function limitToLast(list, max = 200) {
  const safe = Array.isArray(list) ? list : []
  if (safe.length <= max) return safe
  return safe.slice(safe.length - max)
}
