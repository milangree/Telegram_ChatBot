import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createT, normalizeLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../shared/i18n.js'

const STORAGE_KEY = 'ui_locale'

function docLang(locale) {
  if (locale === 'zh-hant') return 'zh-TW'
  if (locale === 'en') return 'en'
  return 'zh-CN'
}

export const useI18nStore = defineStore('i18n', () => {
  const init = normalizeLocale(localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCALE)
  const locale = ref(init)

  const isZh = computed(() => locale.value.startsWith('zh'))
  const localeOptions = computed(() => SUPPORTED_LOCALES)
  const translator = computed(() => createT(locale.value))

  function setLocale(next) {
    locale.value = normalizeLocale(next)
    localStorage.setItem(STORAGE_KEY, locale.value)
    document.documentElement.lang = docLang(locale.value)
  }

  function toggleLocale() {
    const idx = SUPPORTED_LOCALES.indexOf(locale.value)
    const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length]
    setLocale(next)
  }

  function t(key, paramsOrFallback = '', fallback = '') {
    return translator.value(key, paramsOrFallback, fallback)
  }

  return { locale, localeOptions, isZh, t, setLocale, toggleLocale }
})
