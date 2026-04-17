// src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createT, normalizeLocale } from '../../shared/i18n.js'
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
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('store.auth.loginFailed'))
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
        await fetch('/api/auth/logout', { method: 'POST' })
      } catch {
        /* noop */
      }
    }
    resetState()
    clearAuthStorage()
    if (!keepNotice) setAuthNotice('')
  }

  async function checkAuth() {
    const storedToken = localStorage.getItem('token')
    if (!storedToken) return false
    setAuthNotice('')
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${storedToken}` },
      })
      if (!res.ok) {
        let message = ''
        try {
          const data = await res.json()
          message = data?.error || ''
        } catch {
          /* noop */
        }
        const error = new Error(message || t('store.auth.loginFailed'))
        error.status = res.status
        throw error
      }

      const data = await res.json()
      token.value = storedToken
      username.value = data.username
      isAdmin.value = data.isAdmin
      return true
    } catch (error) {
      resetState()
      if (error?.status === 401) {
        markSessionExpired()
      } else {
        clearAuthStorage()
      }
      return false
    }
  }

  return { token, username, isAdmin, isLoggedIn, login, loginTotp, logout, checkAuth, resetState }
})
