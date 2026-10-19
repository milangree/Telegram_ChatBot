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

const MAX_TARGET_LENGTH = 4096
const MAX_REGEX_SOURCE_LENGTH = 200
const MAX_TEXT_RULE_LENGTH = 200
const ALLOWED_REGEX_FLAGS = new Set(['i', 'm', 'u', 's'])

/** 检查正则是否有嵌套量词（ReDoS 风险） */
function hasNestedQuantifiers(source) {
  // 匹配 ( ... + ) + 或 ( ... * ) * 等嵌套量词模式
  return /(\([^)]*[+*][^)]*\))[+*?]/.test(source) || /(\[[^\]]*[+*][^\]]*\])[+*?]/.test(source)
}

/** 额外拦截若干高风险回溯结构 */
function hasRiskyRegexPatterns(source) {
  if (source.length > MAX_REGEX_SOURCE_LENGTH) return true
  // 连续量词 / 重叠量词
  if (/[+*]{2,}/.test(source)) return true
  // 大量可选分支
  if ((source.match(/\|/g) || []).length > 20) return true
  // 回溯敏感：(.+)+ / (.*)+ / (\w+)+ 等
  if (/\((?:[^)\\]|\\.)*[+*](?:[^)\\]|\\.)*\)[+*]/.test(source)) return true
  // 超长字符类重复
  if (/\[[^\]]{40,}\][+*]/.test(source)) return true
  return false
}

function sanitizeRegexFlags(flags) {
  const unique = []
  for (const ch of String(flags || '')) {
    if (ALLOWED_REGEX_FLAGS.has(ch) && !unique.includes(ch)) unique.push(ch)
  }
  // 禁止全局/粘性标志，避免 lastIndex 状态副作用
  return unique.join('')
}

export function normalizeMessageFilterRule(input) {
  const type = MESSAGE_FILTER_RULE_TYPES.includes(input?.type) ? input.type : 'text'
  const value = String(input?.value || '').trim()
  if (!value) throw new Error('Rule value is required')

  if (type === 'regex') {
    const { source, flags } = parseRegexSource(value)
    if (!source) throw new Error('Regex source is required')
    if (source.length > MAX_REGEX_SOURCE_LENGTH) throw new Error('Regex too long')
    if (hasNestedQuantifiers(source) || hasRiskyRegexPatterns(source)) {
      throw new Error('Regex contains nested quantifiers (ReDoS risk)')
    }
    const safeFlags = sanitizeRegexFlags(flags)
    // 校验正则表达式是否合法
     
    new RegExp(source, safeFlags)
    return {
      id: String(input?.id || createRuleId()),
      type,
      value: `/${source}/${safeFlags}`,
    }
  }

  if (value.length > MAX_TEXT_RULE_LENGTH) throw new Error('Rule value too long')
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
      // 忽略无效规则
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
    try {
      const { source, flags } = parseRegexSource(normalized.value)
      const regex = new RegExp(source, flags)
      const target = buildPlainSearchTarget(message).slice(0, MAX_TARGET_LENGTH)
      return regex.test(target)
    } catch {
      return false
    }
  }

  return false
}

export function findMatchedMessageFilterRule(rules, message) {
  for (const rule of parseMessageFilterRules(rules)) {
    if (matchMessageFilterRule(rule, message)) return rule
  }
  return null
}
