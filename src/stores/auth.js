// src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createT, normalizeLocale } from '../../shared/i18n.js'
import { readJsonSafe } from '../utils/http.js'
import { clearLocalCache } from './local-cache.js'

export const AUTH_NOTICE_KEY = 'auth_notice'
export const AUTH_NOTICE_SESSION_EXPIRED = 'session_expired'
export const AUTH_EXPIRED_EVENT = 'app:auth-expired'

function t(key) {
  const locale = normalizeLocale(localStorage.getItem('ui_locale') || 'zh-hans')
  return createT(locale)(key)
}

export function setAuthNotice(reason) {
  if (!reason) {
    sessionStorage.removeItem(AUTH_NOTICE_KEY)
    return
  }
  sessionStorage.setItem(AUTH_NOTICE_KEY, String(reason))
}

export function peekAuthNotice() {
  return sessionStorage.getItem(AUTH_NOTICE_KEY) || ''
}

export function consumeAuthNotice() {
  const reason = peekAuthNotice()
  if (reason) sessionStorage.removeItem(AUTH_NOTICE_KEY)
  return reason
}

export function clearAuthStorage() {
  localStorage.removeItem('token')
  localStorage.removeItem('username')
  localStorage.removeItem('isAdmin')
  clearLocalCache()
}

export function markSessionExpired() {
  clearAuthStorage()
  setAuthNotice(AUTH_NOTICE_SESSION_EXPIRED)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const username = ref(localStorage.getItem('username') || '')
  const isAdmin = ref(localStorage.getItem('isAdmin') === 'true')

  const isLoggedIn = computed(() => !!token.value)

  async function _doLogin(body) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await readJsonSafe(res, {})
    if (!res.ok) throw new Error(data.error || t('store.auth.loginFailed'))
    if (!data.token) throw new Error(t('store.auth.loginFailed'))
    token.value = data.token
    username.value = data.username
    isAdmin.value = data.isAdmin || false
    localStorage.setItem('token', data.token)
    localStorage.setItem('username', data.username)
    localStorage.setItem('isAdmin', String(data.isAdmin || false))
    setAuthNotice('')
    return data
  }

  async function login(u, p, totpCode) {
    return _doLogin({ username: u, password: p, totp: totpCode })
  }

  async function loginTotp(u, totpCode) {
    return _doLogin({ username: u, totp: totpCode, loginMode: 'totp_only' })
  }

  function resetState() {
    token.value = ''
    username.value = ''
    isAdmin.value = false
  }

  async function logout({ skipRequest = false, keepNotice = false } = {}) {
    if (!skipRequest) {
      try {
        const storedToken = localStorage.getItem('token') || token.value
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {},
        })
      } catch {
        /* noop */
      }
    }
    resetState()
    clearAuthStorage()
    if (!keepNotice) setAuthNotice('')
  }

  // 短缓存 + single-flight，避免每次路由导航都打 /auth/me
  let _checkAuthInflight = null
  let _checkAuthCachedAt = 0
  let _checkAuthCachedOk = false
  const CHECK_AUTH_TTL_MS = 15000

  async function checkAuth({ force = false } = {}) {
    const storedToken = localStorage.getItem('token')
    if (!storedToken) return false

    const now = Date.now()
    if (!force && _checkAuthCachedOk && now - _checkAuthCachedAt < CHECK_AUTH_TTL_MS && token.value) {
      return true
    }
    if (!force && _checkAuthInflight) return _checkAuthInflight

    setAuthNotice('')
    _checkAuthInflight = (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${storedToken}` },
          credentials: 'include',
        })
        if (!res.ok) {
          const data = await readJsonSafe(res, {})
          const error = new Error(data?.error || t('store.auth.loginFailed'))
          error.status = res.status
          throw error
        }

        const data = await readJsonSafe(res, {})
        if (!data?.username) {
          const error = new Error(t('store.auth.loginFailed'))
          error.status = res.status
          throw error
        }
        token.value = storedToken
        username.value = data.username
        isAdmin.value = data.isAdmin
        _checkAuthCachedOk = true
        _checkAuthCachedAt = Date.now()
        return true
      } catch (error) {
        // 仅 401 判定会话失效；网络错误等保留本地会话，避免弱网误踢
        if (error?.status === 401) {
          resetState()
          _checkAuthCachedOk = false
          _checkAuthCachedAt = 0
          markSessionExpired()
          return false
        }
        // 非 401：若内存里已有登录态，暂视为仍登录
        if (token.value || storedToken) {
          token.value = storedToken
          return true
        }
        return false
      } finally {
        _checkAuthInflight = null
      }
    })()

    return _checkAuthInflight
  }

  return { token, username, isAdmin, isLoggedIn, login, loginTotp, logout, checkAuth, resetState }
})
