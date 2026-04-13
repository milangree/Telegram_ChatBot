import { createT, getBotCommands, normalizeLocale } from '../../shared/i18n.js'

export function normalizeBotLocale(locale) {
  return normalizeLocale(locale)
}

export function createBotT(locale) {
  const t = createT(normalizeBotLocale(locale))
  return (key, params = {}, fallback = '') => t(`bot.${key}`, params, fallback)
}

export { getBotCommands }
