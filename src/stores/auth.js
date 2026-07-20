// src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createT, normalizeLocale } from '../../shared/i18n.js'
import { readJsonSafe } from '../utils/http.js'
import { clearLocalCache } from './local-cache.js'

export const AUTH_NOTICE_KEY = 'auth_notice'
export const AUTH_NOTICE_SESSION_EXPIRED = 'session_expired'
export const AUTH_EXPIRED_EVENT = 'app:auth-expired'

// 兼容旧版：localStorage.token 仅作迁移期后备，主会话依赖 HttpOnly Cookie
const LEGACY_TOKEN_KEY = 'token'

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
  localStorage.removeItem(LEGACY_TOKEN_KEY)
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

/** 登录成功后统一写入内存态；token 不再落盘（依赖 Set-Cookie） */
function applySession(data, { keepLegacyToken = false } = {}) {
  // data.token 仍可能返回给兼容客户端，但默认不写入 localStorage
  if (keepLegacyToken && data?.token) {
    localStorage.setItem(LEGACY_TOKEN_KEY, data.token)
  } else {
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  }
  if (data?.username != null) localStorage.setItem('username', data.username)
  if (data?.isAdmin != null) localStorage.setItem('isAdmin', String(!!data.isAdmin))
}

export const useAuthStore = defineStore('auth', () => {
  // loggedIn 以 /auth/me 校验结果为准；token 字段仅兼容旧 UI（可能为空）
  const token = ref(localStorage.getItem(LEGACY_TOKEN_KEY) || '')
  const username = ref(localStorage.getItem('username') || '')
  const isAdmin = ref(localStorage.getItem('isAdmin') === 'true')
  const sessionReady = ref(false)

  // sessionReady：Cookie 会话已由 /auth/me 确认；token：兼容遗留 Bearer
  const isLoggedIn = computed(() => sessionReady.value || (!!token.value && !!username.value))

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
    // 主会话靠 Cookie；不再依赖 localStorage.token
    token.value = ''
    username.value = data.username
    isAdmin.value = data.isAdmin || false
    sessionReady.value = true
    // 登录成功后重置失败冷却与缓存，避免后续 checkAuth 被冷却期误判为未登录
    _checkAuthFailedAt = 0
    _checkAuthCachedOk = true
    _checkAuthCachedAt = Date.now()
    applySession(data, { keepLegacyToken: false })
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

  async function loginTotp(u, totpCode) {
    return _doLogin({ username: u, totp: totpCode, loginMode: 'totp_only' })
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
        const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) || token.value
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: legacy ? { Authorization: `Bearer ${legacy}` } : {},
        })
      } catch {
        /* noop */
      }
    }
    resetState()
    clearAuthStorage()
    if (!keepNotice) setAuthNotice('')
  }

  // 短缓存 + single-flight + 失败冷却（防 /api/auth/me 401 刷屏）
  let _checkAuthInflight = null
  let _checkAuthCachedAt = 0
  let _checkAuthCachedOk = false
  let _checkAuthFailedAt = 0
  const CHECK_AUTH_TTL_MS = 15000
  const CHECK_AUTH_FAIL_COOLDOWN_MS = 20000

  async function checkAuth({ force = false } = {}) {
    const now = Date.now()
    if (!force && _checkAuthCachedOk && now - _checkAuthCachedAt < CHECK_AUTH_TTL_MS && sessionReady.value && username.value) {
      return true
    }
    // 已确认登录（如刚 _doLogin 成功）则跳过冷却做一次真实校验；仅在未登录态下冷却，避免 401 刷屏
    if (!force && !sessionReady.value && _checkAuthFailedAt && now - _checkAuthFailedAt < CHECK_AUTH_FAIL_COOLDOWN_MS) {
      return false
    }
    if (!force && _checkAuthInflight) return _checkAuthInflight

    setAuthNotice('')
    _checkAuthInflight = (async () => {
      try {
        const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) || token.value
        const headers = {}
        // 兼容迁移：若仍有旧 token，一并带上；否则纯 Cookie
        if (legacy) headers.Authorization = `Bearer ${legacy}`

        const res = await fetch('/api/auth/me', {
          headers,
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

        // Cookie 会话有效后清理遗留 localStorage token
        if (legacy) localStorage.removeItem(LEGACY_TOKEN_KEY)
        token.value = ''
        username.value = data.username
        isAdmin.value = !!data.isAdmin
        sessionReady.value = true
        localStorage.setItem('username', data.username)
        localStorage.setItem('isAdmin', String(!!data.isAdmin))
        _checkAuthCachedOk = true
        _checkAuthCachedAt = Date.now()
        _checkAuthFailedAt = 0
        return true
      } catch (error) {
        if (error?.status === 401) {
          resetState()
          _checkAuthCachedOk = false
          _checkAuthCachedAt = 0
          _checkAuthFailedAt = Date.now()
          // 不在 checkAuth 内触发 AUTH_EXPIRED_EVENT —— 该事件会调用 router.replace，
          // 与 router.beforeEach 发生并行导航竞态，导致白屏。
          // 导航跳转由 beforeEach 守卫统一处理（→/register 或 /login）。
          setAuthNotice(AUTH_NOTICE_SESSION_EXPIRED)
          return false
        }
        // 非 401：弱网时若已有用户名则暂视为登录
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
    loginTotp,
    telegramLogin,
    logout,
    checkAuth,
    resetState,
    applySession,
  }
})
