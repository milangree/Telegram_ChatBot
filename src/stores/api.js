// src/stores/api.js
import axios from 'axios'
import { createT, normalizeLocale } from '../../shared/i18n.js'
import { isZalgoFilterEnabled, sanitizeDataTree } from '../../shared/display-name.js'
import { readLocalCache } from './local-cache.js'
import { markSessionExpired } from './auth.js'

// withCredentials: 主会话走 HttpOnly Cookie
const api = axios.create({
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function t(key) {
  const locale = normalizeLocale(localStorage.getItem('ui_locale') || 'zh-hans')
  return createT(locale)(key)
}

function shouldSanitizeDisplayNames(payload = null) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'ZALGO_FILTER_ENABLED' in payload) {
    return isZalgoFilterEnabled(payload)
  }

  const cachedSettings = readLocalCache('settings:form', { ttlMs: 5 * 60 * 1000 })
  if (cachedSettings && typeof cachedSettings === 'object' && 'ZALGO_FILTER_ENABLED' in cachedSettings) {
    return isZalgoFilterEnabled(cachedSettings)
  }

  return true
}

api.interceptors.request.use(config => {
  // 兼容迁移期：若仍有遗留 localStorage token 则附带；主路径依赖 Cookie
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => sanitizeDataTree(r.data, shouldSanitizeDisplayNames(r.data)),
  error => {
    const status = error.response?.status
    const message = error.response?.data?.error || error.message || t('store.api.requestFailed')

    // Cookie 会话下：仅在确实有过有效会话时标记过期，避免首次打开页面时误提示
    if (status === 401) {
      const hadSession = localStorage.getItem('username') || localStorage.getItem('token')
      if (hadSession) {
        markSessionExpired()
      }
    }

    const wrapped = new Error(message)
    wrapped.status = status
    return Promise.reject(wrapped)
  }
)

export default api
