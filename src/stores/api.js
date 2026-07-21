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
  // 会话凭据依赖 HttpOnly Cookie，不附加 Bearer 头

  // FormData 上传时不要强制 application/json，让浏览器自动带 multipart boundary
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers) {
      if (typeof config.headers.set === 'function') {
        config.headers.set('Content-Type', undefined)
        config.headers.delete?.('Content-Type')
      } else {
        delete config.headers['Content-Type']
        delete config.headers['content-type']
      }
    }
  }
  return config
})

api.interceptors.response.use(
  r => sanitizeDataTree(r.data, shouldSanitizeDisplayNames(r.data)),
  error => {
    const status = error.response?.status
    const message = error.response?.data?.error || error.message || t('store.api.requestFailed')

    // Cookie 会话下：仅在确实有过有效会话时标记过期，避免首次打开页面时误提示
    if (status === 401) {
      const hadSession = localStorage.getItem('username')
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
