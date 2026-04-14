const ZALGO_MARKS_RE = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf-\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u0903\u200b-\u200f\u2060\ufeff]+/gu

export function isZalgoFilterEnabled(value) {
  if (value === true || value === 'true') return true
  if (!value || typeof value !== 'object') return false
  return value.ZALGO_FILTER_ENABLED === true || value.ZALGO_FILTER_ENABLED === 'true'
}

export function stripZalgoText(value, enabled = true) {
  const text = String(value ?? '')
  if (!enabled || !text) return text

  return text
    .normalize('NFKC')
    .replace(ZALGO_MARKS_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function sanitizeUserLike(user, enabled = true) {
  if (!user || typeof user !== 'object') return user

  return {
    ...user,
    first_name: stripZalgoText(user.first_name, enabled),
    last_name: stripZalgoText(user.last_name, enabled),
    username: stripZalgoText(user.username, enabled),
    title: stripZalgoText(user.title, enabled),
  }
}

export function getDisplayName(user, { stripZalgo = false, fallback = '' } = {}) {
  const normalized = sanitizeUserLike(user, stripZalgo)
  const fullName = [normalized?.first_name, normalized?.last_name].filter(Boolean).join(' ').trim()

  if (fullName) return fullName
  if (normalized?.username) return normalized.username
  if (normalized?.title) return normalized.title
  if (fallback) return fallback

  const id = normalized?.user_id ?? normalized?.id
  return id !== undefined && id !== null ? `User ${id}` : 'User'
}

export function getDisplayInitial(user, { stripZalgo = false, fallback = '?' } = {}) {
  const normalized = sanitizeUserLike(user, stripZalgo)
  const seed = String(
    normalized?.first_name ||
    normalized?.username ||
    normalized?.title ||
    normalized?.user_id ||
    normalized?.id ||
    fallback,
  )
    .replace(/^@/, '')
    .trim()

  return seed ? seed[0].toUpperCase() : fallback
}

export function sanitizeDataTree(value, enabled = true) {
  if (!enabled) return value
  if (Array.isArray(value)) return value.map((item) => sanitizeDataTree(item, enabled))
  if (!value || typeof value !== 'object') return value

  const mapped = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeDataTree(item, enabled)]),
  )

  const hasDisplayFields =
    Object.prototype.hasOwnProperty.call(mapped, 'first_name') ||
    Object.prototype.hasOwnProperty.call(mapped, 'last_name') ||
    Object.prototype.hasOwnProperty.call(mapped, 'username') ||
    Object.prototype.hasOwnProperty.call(mapped, 'title')

  return hasDisplayFields ? sanitizeUserLike(mapped, enabled) : mapped
}
