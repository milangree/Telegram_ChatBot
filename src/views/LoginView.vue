<template>
  <div class="login-wrap">
    <div class="login-card card">
      <div class="login-logo">🤖</div>
      <h1 class="login-title">{{ t('auth.login.title') }}</h1>

      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <div class="login-links">
        <div class="login-link-side login-link-left">
          <RouterLink v-if="needsRegistration" to="/register">{{ t('auth.login.register') }}</RouterLink>
        </div>

        <select class="lang-select login-lang-select" v-model="selectedLocale" :title="t('app.language')">
          <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>

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

        <div class="login-switch">
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
import { computed, onMounted, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
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

function switchMode(nextMode) {
  mode.value = nextMode
  error.value = ''
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
    router.push('/')
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
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAuthStatus()
})
</script>

<style scoped>
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.login-card{width:100%;max-width:380px;padding:36px 28px}
.login-logo{font-size:44px;text-align:center;margin-bottom:12px}
.login-title{font-size:21px;font-weight:700;text-align:center;margin-bottom:22px}
.login-links{margin-bottom:18px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:10px;font-size:13px}
.login-link-side{min-width:0}
.login-link-left{justify-self:start}
.login-link-right{justify-self:end;text-align:right}
.login-lang-select{min-width:132px}
.login-switch{margin-top:12px;text-align:center}
.login-footer{margin-top:20px;text-align:center;font-size:12px;color:var(--text3)}
</style>
