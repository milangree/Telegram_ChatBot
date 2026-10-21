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
  // eslint-disable-next-line eqeqeq
  if (data?.username != null) localStorage.setItem('username', data.username)
  // eslint-disable-next-line eqeqeq
  if (data?.isAdmin != null) localStorage.setItem('isAdmin', String(!!data.isAdmin))
}

export const useAuthStore = defineStore('auth', () => {
  // loggedIn 以 /auth/me 校验结果为准（Cookie 会话）；token 字段仅保留 UI 兼容
  const token = ref('')
  const username = ref(localStorage.getItem('username') || '')
  const isAdmin = ref(localStorage.getItem('isAdmin') === 'true')
  const sessionReady = ref(false)

  // Telegram Mini App 自动登录状态机：idle / checking / success / notDetected / failed
  const autoLoginStatus = ref('idle')
  const autoLoginError = ref('')

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

  /**
   * 等待 Telegram Web App 注入 initData。
   * 结合 web-app-ready 事件 + 短轮询，最长等待 maxWaitMs（默认 1500ms）。
   * 返回 initData 字符串；非 Telegram 环境或超时返回 null。
   *
   * 兼容 Telegram Desktop：桌面版不注入 window.Telegram.WebApp，
   * 而是将 initData 放在 URL 的 #tgWebAppData= 片段中。
   */
  function waitForTelegramInitData(maxWaitMs = 1500) {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(null)
        return
      }

      // 从 URL 片段解析 initData（Telegram Desktop 兼容）
      const initDataFromHash = () => {
        const hash = location.hash
        if (!hash || !hash.includes('tgWebAppData=')) return null
        const params = new URLSearchParams(hash.slice(1))
        return params.get('tgWebAppData') || null
      }

      const webApp = window.Telegram?.WebApp
      // 已经注入则立即返回（移动端）
      if (webApp?.initData) {
        resolve(webApp.initData)
        return
      }
      // 桌面版 fallback：从 URL 片段获取
      const fromHash = initDataFromHash()
      if (fromHash) {
        resolve(fromHash)
        return
      }
      // 没有 WebApp 对象且 URL 片段也没有：不是 Telegram Mini App 环境
      if (!webApp) {
        resolve(null)
        return
      }

      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (pollTimer) clearInterval(pollTimer)
        resolve(value)
      }

      // 1) Telegram 客户端就绪事件（initData 此时通常已可用）
      try {
        webApp.onEvent?.('web-app-ready', () => {
          finish(webApp.initData || initDataFromHash() || null)
        })
      } catch { /* noop */ }

      // 2) 兜底轮询：每 150ms 检查一次 initData 是否已注入
      const pollTimer = setInterval(() => {
        if (webApp?.initData) finish(webApp.initData)
        else if (initDataFromHash()) finish(initDataFromHash())
      }, 150)

      // 3) 超时兜底
      const timer = setTimeout(() => finish(null), maxWaitMs)
    })
  }

  /**
   * 执行 Telegram Mini App 自动登录流程（带状态机）。
   * @returns {'success' | 'notDetected' | 'failed'}
   */
  async function runAutoLogin() {
    if (isLoggedIn.value) {
      autoLoginStatus.value = 'success'
      return 'success'
    }
    autoLoginStatus.value = 'checking'
    autoLoginError.value = ''

    const initData = await waitForTelegramInitData()
    if (!initData) {
      autoLoginStatus.value = 'notDetected'
      return 'notDetected'
    }

    try {
      await telegramLogin(initData)
      autoLoginStatus.value = 'success'
      autoLoginError.value = ''
      return 'success'
    } catch (e) {
      autoLoginStatus.value = 'failed'
      autoLoginError.value = e?.message || ''
      return 'failed'
    }
  }

  function resetAutoLogin() {
    autoLoginStatus.value = 'idle'
    autoLoginError.value = ''
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
      } catch {
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

  /**
   * 敏感操作前强制刷新登录状态
   * @returns {Promise<boolean>} 是否已认证
   */
  async function requireAuth() {
    const ok = await checkAuth({ force: true })
    if (!ok) {
      setAuthNotice(AUTH_NOTICE_SESSION_EXPIRED)
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    }
    return ok
  }

  return {
    token,
    username,
    isAdmin,
    isLoggedIn,
    sessionReady,
    autoLoginStatus,
    autoLoginError,
    login,
    telegramLogin,
    runAutoLogin,
    resetAutoLogin,
    logout,
    checkAuth,
    requireAuth,
    resetState,
    applySession,
  }
})
