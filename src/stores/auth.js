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

/** 登录成功后统一写入内存态；会话凭据依赖 HttpOnly Cookie，不落 localStorage */
function applySession(data) {
  if (data?.username != null) localStorage.setItem('username', data.username)
  if (data?.isAdmin != null) localStorage.setItem('isAdmin', String(!!data.isAdmin))
}

export const useAuthStore = defineStore('auth', () => {
  // loggedIn 以 /auth/me 校验结果为准（Cookie 会话）；token 字段仅保留 UI 兼容
  const token = ref('')
  const username = ref(localStorage.getItem('username') || '')
  const isAdmin = ref(localStorage.getItem('isAdmin') === 'true')
  const sessionReady = ref(false)

  // sessionReady：Cookie 会话已由 /auth/me 确认
  const isLoggedIn = computed(() => sessionReady.value && !!username.value)

  async function _doLogin(body) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    const data = await readJsonSafe(res, {})
    if (!res.ok) {
      const error = new Error(data.error || t('store.auth.loginFailed'))
      error.status = res.status
      throw error
    }
    if (!data.username) throw new Error(t('store.auth.loginFailed'))
    // 主会话靠 HttpOnly Cookie；token 不落 localStorage
    token.value = ''
    username.value = data.username
    isAdmin.value = data.isAdmin || false
    sessionReady.value = true
    // 登录成功后重置缓存
    _checkAuthCachedOk = true
    _checkAuthCachedAt = Date.now()
    applySession(data)
    setAuthNotice('')
    return data
  }

  /**
   * Telegram Web App 自动登录。
   * 在 Telegram 环境中用 initData 调用 /api/auth/login，
   * 通过 ADMIN_IDS 校验直接签发 Cookie 会话，跳过密码输入。
   */
  async function telegramLogin(initData) {
    return _doLogin({ initData })
  }

  async function login(u, p, totpCode) {
    return _doLogin({ username: u, password: p, totp: totpCode })
  }

  function resetState() {
    token.value = ''
    username.value = ''
    isAdmin.value = false
    sessionReady.value = false
  }

  async function logout({ skipRequest = false, keepNotice = false } = {}) {
    if (!skipRequest) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        })
      } catch {
        /* noop */
      }
    }
    resetState()
    clearAuthStorage()
    if (!keepNotice) setAuthNotice('')
  }

  // 短缓存 + single-flight（防 /api/auth/me 401 刷屏）
  let _checkAuthInflight = null
  let _checkAuthCachedAt = 0
  let _checkAuthCachedOk = false
  const CHECK_AUTH_TTL_MS = 15000
  async function checkAuth({ force = false } = {}) {
    const now = Date.now()
    if (!force && _checkAuthCachedOk && now - _checkAuthCachedAt < CHECK_AUTH_TTL_MS && sessionReady.value && username.value) {
      return true
    }
    if (!force && _checkAuthInflight) return _checkAuthInflight

    setAuthNotice('')
    _checkAuthInflight = (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
        })

        // 401 直接处理，不抛出 Error，避免浏览器控制台打印"未授权"错误
        if (res.status === 401) {
          const hadSession = sessionReady.value || !!username.value
          resetState()
          _checkAuthCachedOk = false
          _checkAuthCachedAt = 0
          // 仅在确实有过有效会话时才设"登录已过期"通知；
          // 首次打开页面或刚退出登录时不应提示过期，避免误导用户。
          if (hadSession) {
            setAuthNotice(AUTH_NOTICE_SESSION_EXPIRED)
          }
          return false
        }

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

        // Cookie 会话有效
        token.value = ''
        username.value = data.username
        isAdmin.value = !!data.isAdmin
        sessionReady.value = true
        localStorage.setItem('username', data.username)
        localStorage.setItem('isAdmin', String(!!data.isAdmin))
        _checkAuthCachedOk = true
        _checkAuthCachedAt = Date.now()
        return true
      } catch (error) {
        // 非 401 错误：弱网时若已有用户名则暂视为登录
        if (username.value) {
          sessionReady.value = true
          return true
        }
        return false
      } finally {
        _checkAuthInflight = null
      }
    })()

    return _checkAuthInflight
  }

  return {
    token,
    username,
    isAdmin,
    isLoggedIn,
    sessionReady,
    login,
    telegramLogin,
    logout,
    checkAuth,
    resetState,
    applySession,
  }
})
