// src/stores/api.js
import axios from 'axios'
import { createT, normalizeLocale } from '../../shared/i18n.js'

const api = axios.create({ timeout: 30000, headers: { 'Content-Type': 'application/json' }, withCredentials: true })

function t(key) {
  const locale = normalizeLocale(localStorage.getItem('ui_locale') || 'zh-hans')
  return createT(locale)(key)
}

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r.data,
  error => {
    const status  = error.response?.status
    const message = error.response?.data?.error || error.message || t('store.api.requestFailed')
    if (status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('username')
      localStorage.removeItem('isAdmin')
    }
    return Promise.reject(new Error(message))
  }
)

export default api
