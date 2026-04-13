import zhHans from './locales/zh-hans.js'
import zhHant from './locales/zh-hant.js'
import en from './locales/en.js'

export const SUPPORTED_LOCALES = ['zh-hans', 'zh-hant', 'en']
export const DEFAULT_LOCALE = 'zh-hans'

export const MESSAGES = {
  'zh-hans': zhHans,
  'zh-hant': { ...zhHans, ...zhHant },
  en: { ...zhHans, ...en },
}

export function normalizeLocale(input) {
  const v = String(input || '').toLowerCase()
  if (v === 'zh' || v === 'zh-cn' || v === 'zh_hans') return 'zh-hans'
  if (v === 'zh-tw' || v === 'zh-hk' || v === 'zh_hant') return 'zh-hant'
  return SUPPORTED_LOCALES.includes(v) ? v : DEFAULT_LOCALE
}

export function formatText(text, params = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, token) => {
    const val = params[token]
    return val === undefined || val === null ? '' : String(val)
  })
}

export function createT(locale) {
  const normalized = normalizeLocale(locale)
  return (key, paramsOrFallback = '', fallback = '') => {
    const found = MESSAGES[normalized]?.[key] ?? MESSAGES[DEFAULT_LOCALE]?.[key]
    const raw = found ?? (typeof paramsOrFallback === 'string' ? paramsOrFallback : fallback || key)
    if (paramsOrFallback && typeof paramsOrFallback === 'object' && !Array.isArray(paramsOrFallback)) {
      return formatText(raw, paramsOrFallback)
    }
    return raw
  }
}

export function getBotCommands(locale) {
  const t = createT(locale)
  const userCmds = [
    { command: 'start', description: t('bot.cmd.start') },
    { command: 'help', description: t('bot.cmd.help') },
    { command: 'status', description: t('bot.cmd.status') },
  ]
  const adminCmds = [
    ...userCmds,
    { command: 'stats', description: t('bot.cmd.stats') },
    { command: 'ban', description: t('bot.cmd.ban') },
    { command: 'unban', description: t('bot.cmd.unban') },
    { command: 'wl', description: t('bot.cmd.wl') },
    { command: 'unwl', description: t('bot.cmd.unwl') },
    { command: 'info', description: t('bot.cmd.info') },
    { command: 'panel', description: t('bot.cmd.panel') },
  ]
  return { userCmds, adminCmds }
}
