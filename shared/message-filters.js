export const MESSAGE_FILTER_RULE_TYPES = ['text', 'regex']

function createRuleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function collectSearchValues(value, out, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim()
    if (text) out.push(text)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) collectSearchValues(item, out, depth + 1)
    return
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectSearchValues(item, out, depth + 1)
  }
}

function buildPlainSearchTarget(message) {
  const values = []
  collectSearchValues(message, values)
  return values.join('\n').toLowerCase()
}

function parseRegexSource(raw) {
  const input = String(raw || '').trim()
  if (!input) return { source: '', flags: '' }

  const match = input.match(/^\/([\s\S]*)\/([a-z]*)$/i)
  if (!match) return { source: input, flags: '' }

  return {
    source: match[1],
    flags: match[2] || '',
  }
}

export function normalizeMessageFilterRule(input) {
  const type = MESSAGE_FILTER_RULE_TYPES.includes(input?.type) ? input.type : 'text'
  const value = String(input?.value || '').trim()
  if (!value) throw new Error('Rule value is required')

  if (type === 'regex') {
    const { source, flags } = parseRegexSource(value)
    if (!source) throw new Error('Regex source is required')
    // 校验正则表达式是否合法
    // eslint-disable-next-line no-new
    new RegExp(source, flags)
    return {
      id: String(input?.id || createRuleId()),
      type,
      value: `/${source}/${flags}`,
    }
  }

  return {
    id: String(input?.id || createRuleId()),
    type: 'text',
    value,
  }
}

export function parseMessageFilterRules(raw) {
  const source = Array.isArray(raw)
    ? raw
    : safeJsonParse(String(raw || '[]'), [])

  if (!Array.isArray(source)) return []

  const rules = []
  for (const item of source) {
    try {
      rules.push(normalizeMessageFilterRule(item))
    } catch {
    }
  }
  return rules
}

export function serializeMessageFilterRules(rules) {
  return JSON.stringify(parseMessageFilterRules(rules))
}

export function getMessageFilterRuleLabel(rule) {
  const normalized = normalizeMessageFilterRule(rule)
  return `${normalized.type}: ${normalized.value}`
}

export function matchMessageFilterRule(rule, message) {
  const normalized = normalizeMessageFilterRule(rule)

  if (normalized.type === 'text') {
    const haystack = buildPlainSearchTarget(message)
    return haystack.includes(normalized.value.toLowerCase())
  }

  if (normalized.type === 'regex') {
    const { source, flags } = parseRegexSource(normalized.value)
    const regex = new RegExp(source, flags)
    const target = buildPlainSearchTarget(message)
    return regex.test(target)
  }

  return false
}

export function findMatchedMessageFilterRule(rules, message) {
  for (const rule of parseMessageFilterRules(rules)) {
    if (matchMessageFilterRule(rule, message)) return rule
  }
  return null
}
