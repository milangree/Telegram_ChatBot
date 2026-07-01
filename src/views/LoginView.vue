<template>
  <div class="login-wrap">
    <div class="login-card card">
      <div class="login-topbar">
        <select class="lang-select login-lang-select" v-model="selectedLocale" :title="t('app.language')">
          <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <div class="theme-menu-wrap login-theme-wrap">
          <button class="btn-icon theme-trigger" type="button" @click.stop="toggleThemeMenu" :title="t('app.toggleTheme')">
            <AppIcon :name="currentThemeOption.icon" :size="18" />
          </button>
          <div v-if="themeMenuOpen" class="theme-menu">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              class="theme-menu-item"
              :class="{ active: themeMode === option.value }"
              type="button"
              @click.stop="applyTheme(option.value)"
            >
              <AppIcon :name="option.icon" :size="16" class="theme-menu-icon" />
              <span class="theme-menu-label">{{ option.label }}</span>
              <span class="theme-menu-check">{{ themeMode === option.value ? '●' : '' }}</span>
            </button>
          </div>
        </div>
        <button class="btn-icon glass-toggle-btn login-glass-btn" type="button" @click="toggleGlass" :title="glassEnabled ? t('app.disableGlass') : t('app.enableGlass')">
          <span class="glass-toggle-icon" :class="{ active: glassEnabled }" aria-hidden="true"></span>
        </button>
      </div>

      <div class="login-logo">
        <AppIcon name="logo" :size="44" />
      </div>
      <h1 class="login-title">{{ t('auth.login.title') }}</h1>

      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <div class="login-links">
        <div class="login-link-side login-link-left">
          <RouterLink v-if="needsRegistration" to="/register">{{ t('auth.login.register') }}</RouterLink>
        </div>

        <div class="login-link-side login-link-right">
          <RouterLink to="/recover">{{ t('auth.login.recover') }}</RouterLink>
        </div>
      </div>

      <div class="form-group">
        <label>{{ t('auth.login.username') }}</label>
        <input
          v-model="username"
          :placeholder="t('auth.login.username')"
          autocomplete="username"
          @keydown.enter="mode === 'password' ? handleLogin() : handleLoginTotp()"
        />
      </div>

      <template v-if="mode === 'password'">
        <div class="form-group">
          <label>{{ t('auth.login.password') }}</label>
          <input
            v-model="password"
            type="password"
            :placeholder="t('auth.login.password')"
            autocomplete="current-password"
            @keydown.enter="handleLogin"
          />
        </div>

        <button class="btn-primary w-full" :disabled="loading" @click="handleLogin">
          <span v-if="loading" class="spinner"></span>{{ loading ? t('auth.login.loggingIn') : t('auth.login.login') }}
        </button>

        <div v-if="totpAvailable" class="login-switch">
          <button class="btn-ghost btn-sm" type="button" :disabled="loading" @click="switchMode('totp_only')">
            {{ t('auth.login.switchToTotp') }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="form-group">
          <label>{{ t('auth.login.totp') }} <span class="text-muted">({{ t('auth.login.sixDigits') }})</span></label>
          <input
            v-model="totp"
            :placeholder="t('auth.login.totp')"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            @keydown.enter="handleLoginTotp"
          />
        </div>

        <button class="btn-primary w-full" :disabled="loading" @click="handleLoginTotp">
          <span v-if="loading" class="spinner"></span>{{ loading ? t('auth.login.loggingIn') : t('auth.login.login') }}
        </button>

        <div class="login-switch">
          <button class="btn-ghost btn-sm" type="button" :disabled="loading" @click="switchMode('password')">
            {{ t('auth.login.switchToPassword') }}
          </button>
        </div>
      </template>

      <div class="login-footer">{{ t('auth.login.defaultAccountTip') }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import { AUTH_NOTICE_SESSION_EXPIRED, consumeAuthNotice, useAuthStore } from '../stores/auth'
import { useI18nStore } from '../stores/i18n'

const auth = useAuthStore()
const i18n = useI18nStore()
const t = i18n.t
const router = useRouter()

const mode = ref('password')
const username = ref('')
const password = ref('')
const totp = ref('')
const loading = ref(false)
const error = ref('')
const needsRegistration = ref(false)
const totpAvailable = ref(false)
const isDark = ref(true)
const themeMode = ref('system')
const themeMenuOpen = ref(false)
const glassEnabled = ref(false)

let totpStatusTimer = null
let totpStatusSeq = 0
let systemThemeQuery = null

const localeOptions = computed(() =>
  i18n.localeOptions.map((locale) => {
    if (locale === 'zh-hant') return { value: locale, label: t('app.lang.zhHant') }
    if (locale === 'en') return { value: locale, label: t('app.lang.en') }
    return { value: locale, label: t('app.lang.zhHans') }
  }),
)

const selectedLocale = computed({
  get: () => i18n.locale,
  set: (next) => i18n.setLocale(next),
})

const themeOptions = computed(() => [
  { value: 'light', label: t('app.themeLight'), icon: 'light' },
  { value: 'dark', label: t('app.themeDark'), icon: 'dark' },
  { value: 'system', label: t('app.themeSystem'), icon: 'system' },
])

const currentThemeOption = computed(() => (
  themeOptions.value.find((option) => option.value === themeMode.value) || themeOptions.value[2]
))

function switchMode(nextMode) {
  if (nextMode === 'totp_only' && !totpAvailable.value) return
  mode.value = nextMode
  error.value = ''
}

function toggleThemeMenu() {
  themeMenuOpen.value = !themeMenuOpen.value
}

function closeThemeMenu() {
  themeMenuOpen.value = false
}

function resolveThemeMode(modeName) {
  if (modeName === 'system') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? 'dark' : 'light'
  }
  return modeName === 'light' ? 'light' : 'dark'
}

function applyResolvedTheme(resolved) {
  isDark.value = resolved !== 'light'
  document.documentElement.classList.toggle('light', resolved === 'light')
}

function applyTheme(modeName) {
  const normalized = ['light', 'dark', 'system'].includes(modeName) ? modeName : 'system'
  themeMode.value = normalized
  const resolved = resolveThemeMode(normalized)
  applyResolvedTheme(resolved)
  localStorage.setItem('theme_mode', normalized)
  localStorage.setItem('theme', resolved)
  themeMenuOpen.value = false
}

function handleSystemThemeChange() {
  if (themeMode.value !== 'system') return
  const resolved = resolveThemeMode('system')
  applyResolvedTheme(resolved)
  localStorage.setItem('theme', resolved)
}

function applyGlass(enabled) {
  glassEnabled.value = !!enabled
  document.documentElement.classList.toggle('glass', glassEnabled.value)
  localStorage.setItem('visual_glass', glassEnabled.value ? 'true' : 'false')
}

function toggleGlass() {
  applyGlass(!glassEnabled.value)
}

async function loadAuthStatus() {
  try {
    const res = await fetch('/api/auth/status')
    const data = await res.json()
    needsRegistration.value = !!data.needsRegistration
  } catch {
    needsRegistration.value = false
  }
}

async function checkTotpStatus(nextUsername = username.value) {
  const currentUsername = String(nextUsername || '').trim()
  const currentSeq = ++totpStatusSeq

  if (!currentUsername) {
    totpAvailable.value = false
    if (mode.value === 'totp_only') mode.value = 'password'
    return
  }

  try {
    const res = await fetch('/api/auth/totp-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUsername }),
    })
    const data = await res.json()

    if (currentSeq !== totpStatusSeq) return

    totpAvailable.value = !!data.totpEnabled
    if (!totpAvailable.value && mode.value === 'totp_only') {
      mode.value = 'password'
    }
  } catch {
    if (currentSeq !== totpStatusSeq) return
    totpAvailable.value = false
    if (mode.value === 'totp_only') mode.value = 'password'
  }
}

async function handleLogin() {
  if (!username.value.trim()) {
    error.value = t('auth.login.err.needUsername')
    return
  }
  if (!password.value) {
    error.value = t('auth.login.err.needPassword')
    return
  }

  loading.value = true
  error.value = ''
  try {
    await auth.login(username.value, password.value)
    await router.replace('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function handleLoginTotp() {
  if (!username.value.trim()) {
    error.value = t('auth.login.err.needUsername')
    return
  }
  if (!totp.value) {
    error.value = t('auth.login.err.needTotp')
    return
  }

  loading.value = true
  error.value = ''
  try {
    await auth.loginTotp(username.value, totp.value)
    await router.replace('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(username, (next) => {
  if (totpStatusTimer) clearTimeout(totpStatusTimer)

  const trimmed = String(next || '').trim()
  if (!trimmed) {
    totpAvailable.value = false
    if (mode.value === 'totp_only') mode.value = 'password'
    return
  }

  totpStatusTimer = setTimeout(() => {
    checkTotpStatus(trimmed)
  }, 220)
})

onMounted(() => {
  const authNotice = consumeAuthNotice()
  if (authNotice === AUTH_NOTICE_SESSION_EXPIRED) {
    error.value = t('auth.login.sessionExpired')
  }

  loadAuthStatus()

  const savedMode = localStorage.getItem('theme_mode')
  const legacyTheme = localStorage.getItem('theme')

  if (savedMode === 'light' || savedMode === 'dark' || savedMode === 'system') {
    applyTheme(savedMode)
  } else if (legacyTheme === 'light' || legacyTheme === 'dark') {
    applyTheme(legacyTheme)
  } else {
    applyTheme('system')
  }

  applyGlass(localStorage.getItem('visual_glass') === 'true')

  if (window.matchMedia) {
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', handleSystemThemeChange)
    else if (systemThemeQuery.addListener) systemThemeQuery.addListener(handleSystemThemeChange)
  }

  document.addEventListener('click', closeThemeMenu)
})

onBeforeUnmount(() => {
  if (totpStatusTimer) clearTimeout(totpStatusTimer)
  document.removeEventListener('click', closeThemeMenu)

  if (systemThemeQuery?.removeEventListener) systemThemeQuery.removeEventListener('change', handleSystemThemeChange)
  else if (systemThemeQuery?.removeListener) systemThemeQuery.removeListener(handleSystemThemeChange)
})
</script>

<style scoped>
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.login-card{width:100%;max-width:380px;padding:20px 28px 36px}
.login-topbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:12px}
.login-theme-wrap,.login-glass-btn{flex-shrink:0}
.login-logo{display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.login-title{font-size:21px;font-weight:700;text-align:center;margin-bottom:22px}
.login-links{margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.login-link-side{min-width:0}
.login-link-left{justify-self:start}
.login-link-right{justify-self:end;text-align:right}
.login-lang-select{min-width:0;max-width:132px;flex:1}
.login-switch{margin-top:12px;text-align:center}
.login-footer{margin-top:20px;text-align:center;font-size:12px;color:var(--text3)}

@media (max-width: 480px){
  .login-wrap{padding:14px}
  .login-card{padding:18px 18px 28px}
  .login-topbar{gap:6px}
  .login-lang-select{max-width:104px;font-size:12px}
  .login-links{font-size:12px;gap:10px}
}
</style>
