// src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createT, normalizeLocale } from '../../shared/i18n.js'

function t(key) {
  const locale = normalizeLocale(localStorage.getItem('ui_locale') || 'zh-hans')
  return createT(locale)(key)
}

export const useAuthStore = defineStore('auth', () => {
  const token    = ref(localStorage.getItem('token') || '')
  const username = ref(localStorage.getItem('username') || '')
  const isAdmin  = ref(localStorage.getItem('isAdmin') === 'true')

  const isLoggedIn = computed(() => !!token.value)

  async function _doLogin(body) {
    const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('store.auth.loginFailed'))
    token.value    = data.token
    username.value = data.username
    isAdmin.value  = data.isAdmin || false
    localStorage.setItem('token',    data.token)
    localStorage.setItem('username', data.username)
    localStorage.setItem('isAdmin',  String(data.isAdmin || false))
    return data
  }

  async function login(u, p, totpCode) {
    return _doLogin({ username: u, password: p, totp: totpCode })
  }

  async function loginTotp(u, totpCode) {
    return _doLogin({ username: u, totp: totpCode, loginMode: 'totp_only' })
  }

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* noop */ }
    token.value = ''; username.value = ''; isAdmin.value = false
    localStorage.removeItem('token'); localStorage.removeItem('username'); localStorage.removeItem('isAdmin')
  }

  async function checkAuth() {
    const t = localStorage.getItem('token')
    if (!t) return false
    try {
      const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${t}` } })
      if (!res.ok) throw new Error()
      const data = await res.json()
      token.value = t; username.value = data.username; isAdmin.value = data.isAdmin
      return true
    } catch { await logout(); return false }
  }

  return { token, username, isAdmin, isLoggedIn, login, loginTotp, logout, checkAuth }
})
