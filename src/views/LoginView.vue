<template>
  <div style="width:420px;max-width:calc(100vw - 32px);padding:16px;margin:0 auto">
    <v-card elevation="8" rounded="xl" class="overflow-hidden" style="width:100%">
      <!-- 顶部装饰条 -->
      <div style="height:4px;background:linear-gradient(90deg, var(--v-theme-primary), var(--v-theme-secondary))" />

      <div class="pa-7 pb-6">
        <!-- 语言 + 主题切换 -->
        <div class="d-flex justify-end align-center ga-1 mb-5">
          <v-btn-toggle v-model="selectedThemeIdx" mandatory variant="text" density="compact" rounded="lg" divided>
            <v-btn :value="0" size="x-small"><v-icon :icon="mdiWeatherSunny" size="16" /></v-btn>
            <v-btn :value="1" size="x-small"><v-icon :icon="mdiWeatherNight" size="16" /></v-btn>
            <v-btn :value="2" size="x-small"><v-icon :icon="mdiThemeLightDark" size="16" /></v-btn>
          </v-btn-toggle>
          <v-divider vertical class="mx-1" />
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" variant="text" size="x-small" class="text-caption">
                {{ currentLocaleLabel }}
              </v-btn>
            </template>
            <v-list density="compact" rounded="lg" elevation="3">
              <v-list-item
                v-for="opt in localeOptions" :key="opt.value"
                :title="opt.label" @click="selectedLocale = opt.value"
              >
                <template #append>
                  <v-icon v-if="i18n.locale === opt.value" :icon="mdiCheck" size="16" color="primary" />
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>

        <!-- Logo + 标题 -->
        <div class="text-center mb-6">
          <v-avatar size="64" color="primary" rounded="xl" class="mb-3">
            <v-icon :icon="mdiRobotOutline" size="36" />
          </v-avatar>
          <h1 class="text-h5 font-weight-bold mb-1">{{ t('auth.login.title') }}</h1>
          <p class="text-body-2 text-medium-emphasis">{{ t('auth.login.defaultAccountTip') }}</p>
        </div>

        <!-- 错误提示 -->
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" closable @click:close="error = ''">
          {{ error }}
        </v-alert>

        <!-- 登录模式切换 -->
        <v-tabs v-model="mode" density="compact" class="mb-5" grow color="primary">
          <v-tab value="password" :prepend-icon="mdiLock">{{ t('auth.login.password') }}</v-tab>
          <v-tab value="totp_only" :prepend-icon="mdiKeyVariant" :disabled="!totpAvailable">{{ t('auth.login.totp') }}</v-tab>
        </v-tabs>

        <v-window v-model="mode">
          <!-- 密码登录 -->
          <v-window-item value="password">
            <v-text-field
              v-model="username"
              :label="t('auth.login.username')"
              autocomplete="username"
              :prepend-inner-icon="mdiAccount"
              density="comfortable"
              @keydown.enter="$refs.pwInput?.focus()"
            />
            <v-text-field
              ref="pwInput"
              v-model="password"
              :label="t('auth.login.password')"
              type="password"
              autocomplete="current-password"
              :prepend-inner-icon="mdiLock"
              density="comfortable"
              @keydown.enter="handleLogin"
            />
            <v-btn
              block color="primary" size="large" rounded="lg"
              :loading="loading" class="mt-2"
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
              density="comfortable"
            />
            <v-text-field
              v-model="totp"
              :label="t('auth.login.totp')"
              :placeholder="t('auth.login.sixDigits')"
              maxlength="6"
              inputmode="numeric"
              autocomplete="one-time-code"
              :prepend-inner-icon="mdiKeyVariant"
              density="comfortable"
              @keydown.enter="handleLoginTotp"
            />
            <v-btn
              block color="primary" size="large" rounded="lg"
              :loading="loading" class="mt-2"
              @click="handleLoginTotp"
            >
              {{ t('auth.login.login') }}
            </v-btn>
          </v-window-item>
        </v-window>

        <!-- 底部链接 -->
        <div class="d-flex justify-space-between mt-5">
          <RouterLink v-if="needsRegistration" to="/register" class="text-body-2 text-primary text-decoration-none">
            {{ t('auth.login.register') }}
          </RouterLink>
          <span v-else />
          <RouterLink to="/recover" class="text-body-2 text-primary text-decoration-none">
            {{ t('auth.login.recover') }}
          </RouterLink>
        </div>
      </div>
    </v-card>
  </div>
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

const currentLocaleLabel = computed(() => {
  const opt = localeOptions.value.find(o => o.value === i18n.locale)
  return opt?.label || i18n.locale
})

const selectedLocale = computed({
  get: () => i18n.locale,
  set: (next) => i18n.setLocale(next),
})

const themeMap = ['light', 'dark', 'system']
const selectedThemeIdx = computed({
  get: () => themeMap.indexOf(themeMode.value),
  set: (idx) => applyTheme(themeMap[idx] || 'system'),
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
