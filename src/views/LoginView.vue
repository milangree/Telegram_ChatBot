<template>
  <v-container fluid class="d-flex align-center justify-center" style="min-height:100vh">
    <v-card width="400" class="pa-5" rounded="xl">
      <!-- 顶栏：语言 + 主题 -->
      <div class="d-flex justify-end align-center ga-2 mb-3">
        <v-select
          v-model="selectedLocale"
          :items="localeOptions"
          item-title="label"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width:130px"
        />
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" icon size="small">
              <v-icon :icon="currentThemeIcon" size="20" />
            </v-btn>
          </template>
          <v-list density="compact" rounded="lg" elevation="3">
            <v-list-item
              v-for="opt in themeOptions" :key="opt.value"
              :prepend-icon="opt.icon" :title="opt.label"
              @click="applyTheme(opt.value)"
            >
              <template #append>
                <v-icon v-if="themeMode === opt.value" :icon="mdiCheck" size="18" color="primary" />
              </template>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>

      <!-- Logo + 标题 -->
      <div class="text-center mb-4">
        <v-icon :icon="mdiRobotOutline" size="48" color="primary" class="mb-2" />
        <h1 class="text-h5 font-weight-bold">{{ t('auth.login.title') }}</h1>
      </div>

      <!-- 错误提示 -->
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">
        {{ error }}
      </v-alert>

      <!-- 链接 -->
      <div class="d-flex justify-space-between mb-4 text-caption">
        <RouterLink v-if="needsRegistration" to="/register" class="text-primary">
          {{ t('auth.login.register') }}
        </RouterLink>
        <span v-else />
        <RouterLink to="/recover" class="text-primary">
          {{ t('auth.login.recover') }}
        </RouterLink>
      </div>

      <!-- 登录模式切换 -->
      <v-tabs v-model="mode" density="compact" class="mb-4" grow>
        <v-tab value="password">{{ t('auth.login.password') }}</v-tab>
        <v-tab value="totp_only" :disabled="!totpAvailable">{{ t('auth.login.totp') }}</v-tab>
      </v-tabs>

      <v-window v-model="mode">
        <!-- 密码登录 -->
        <v-window-item value="password">
          <v-text-field
            v-model="username"
            :label="t('auth.login.username')"
            autocomplete="username"
            :prepend-inner-icon="mdiAccount"
            @keydown.enter="$refs.pwInput?.focus()"
          />
          <v-text-field
            ref="pwInput"
            v-model="password"
            :label="t('auth.login.password')"
            type="password"
            autocomplete="current-password"
            prepend-inner-:icon="mdiLock"
            @keydown.enter="handleLogin"
          />
          <v-btn
            block color="primary" size="large"
            :loading="loading"
            @click="handleLogin"
          >
            {{ t('auth.login.login') }}
          </v-btn>
        </v-window-item>

        <!-- TOTP 登录 -->
        <v-window-item value="totp_only">
          <v-text-field
            v-model="username"
            :label="t('auth.login.username')"
            autocomplete="username"
            :prepend-inner-icon="mdiAccount"
          />
          <v-text-field
            v-model="totp"
            :label="t('auth.login.totp')"
            :placeholder="t('auth.login.sixDigits')"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            :prepend-inner-icon="mdiKeyVariant"
            @keydown.enter="handleLoginTotp"
          />
          <v-btn
            block color="primary" size="large"
            :loading="loading"
            @click="handleLoginTotp"
          >
            {{ t('auth.login.login') }}
          </v-btn>
        </v-window-item>
      </v-window>

      <!-- 默认账号提示 -->
      <p class="text-caption text-medium-emphasis text-center mt-5">
        {{ t('auth.login.defaultAccountTip') }}
      </p>
    </v-card>
  </v-container>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useTheme } from 'vuetify'
import { mdiWeatherSunny, mdiWeatherNight, mdiThemeLightDark, mdiRobotOutline, mdiAccount, mdiLock, mdiKeyVariant, mdiCheck } from '@mdi/js'
import { AUTH_NOTICE_SESSION_EXPIRED, consumeAuthNotice, useAuthStore } from '../stores/auth'
import { useI18nStore } from '../stores/i18n'

const auth = useAuthStore()
const i18n = useI18nStore()
const t = i18n.t
const router = useRouter()
const vTheme = useTheme()

const mode = ref('password')
const username = ref('')
const password = ref('')
const totp = ref('')
const loading = ref(false)
const error = ref('')
const needsRegistration = ref(false)
const totpAvailable = ref(false)
const themeMode = ref('system')

let totpStatusTimer = null
let totpStatusSeq = 0

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
  { value: 'light', label: t('app.themeLight'), icon: mdiWeatherSunny },
  { value: 'dark', label: t('app.themeDark'), icon: mdiWeatherNight },
  { value: 'system', label: t('app.themeSystem'), icon: mdiThemeLightDark },
])

const currentThemeIcon = computed(() => {
  const opt = themeOptions.value.find(o => o.value === themeMode.value)
  return opt?.icon || mdiThemeLightDark
})

function resolveThemeMode(m) {
  if (m === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return m === 'light' ? 'light' : 'dark'
}

function applyTheme(m) {
  const normalized = ['light', 'dark', 'system'].includes(m) ? m : 'system'
  themeMode.value = normalized
  const resolved = resolveThemeMode(normalized)
  vTheme.global.name.value = resolved === 'light' ? 'lightTheme' : 'darkTheme'
  document.documentElement.classList.toggle('light', resolved === 'light')
  localStorage.setItem('theme_mode', normalized)
  localStorage.setItem('theme', resolved)
}

async function loadAuthStatus() {
  try {
    const res = await fetch('/api/auth/status')
    const data = await res.json()
    needsRegistration.value = !!data.needsRegistration
  } catch { needsRegistration.value = false }
}

async function checkTotpStatus(nextUsername = username.value) {
  const current = String(nextUsername || '').trim()
  const seq = ++totpStatusSeq
  if (!current) { totpAvailable.value = false; return }
  try {
    const res = await fetch('/api/auth/totp-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: current }),
    })
    const data = await res.json()
    if (seq !== totpStatusSeq) return
    totpAvailable.value = !!data.totpEnabled
  } catch {
    if (seq !== totpStatusSeq) return
    totpAvailable.value = false
  }
}

async function handleLogin() {
  if (!username.value.trim()) { error.value = t('auth.login.err.needUsername'); return }
  if (!password.value) { error.value = t('auth.login.err.needPassword'); return }
  loading.value = true; error.value = ''
  try { await auth.login(username.value, password.value); await router.replace('/') }
  catch (e) { error.value = e.message }
  finally { loading.value = false }
}

async function handleLoginTotp() {
  if (!username.value.trim()) { error.value = t('auth.login.err.needUsername'); return }
  if (!totp.value) { error.value = t('auth.login.err.needTotp'); return }
  loading.value = true; error.value = ''
  try { await auth.loginTotp(username.value, totp.value); await router.replace('/') }
  catch (e) { error.value = e.message }
  finally { loading.value = false }
}

watch(username, (next) => {
  clearTimeout(totpStatusTimer)
  const trimmed = String(next || '').trim()
  if (!trimmed) { totpAvailable.value = false; return }
  totpStatusTimer = setTimeout(() => checkTotpStatus(trimmed), 220)
})

onMounted(() => {
  const notice = consumeAuthNotice()
  if (notice === AUTH_NOTICE_SESSION_EXPIRED) error.value = t('auth.login.sessionExpired')
  loadAuthStatus()
  const saved = localStorage.getItem('theme_mode')
  const legacy = localStorage.getItem('theme')
  if (['light', 'dark', 'system'].includes(saved)) applyTheme(saved)
  else if (legacy === 'light' || legacy === 'dark') applyTheme(legacy)
  else applyTheme('system')
})

onBeforeUnmount(() => { clearTimeout(totpStatusTimer) })
</script>
