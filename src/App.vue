<template>
  <v-app>
    <!-- ═══ 登录态布局 ═══ -->
    <template v-if="auth.isLoggedIn">
      <!-- 侧边栏 -->
      <v-navigation-drawer
        v-model="drawer"
        :permanent="!isMobile"
        :temporary="isMobile"
        width="240"
        color="surface"
      >
        <v-list-item
          class="py-4 px-5"
          :title="t('app.title')"
          :subtitle="auth.username"
        >
          <template #prepend>
            <v-avatar color="primary" size="36" rounded="lg">
              <span class="text-white font-weight-bold">{{ auth.username?.[0]?.toUpperCase() || 'U' }}</span>
            </v-avatar>
          </template>
        </v-list-item>

        <v-divider class="mb-1" />

        <v-list nav density="compact" class="px-2">
          <v-list-item
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :prepend-icon="item.icon"
            :title="item.label"
            rounded="lg"
            color="primary"
          />
        </v-list>

        <template #append>
          <div class="pa-3 d-flex flex-column ga-1">
            <v-select
              v-model="selectedLocale"
              :items="localeOptions"
              item-title="label"
              item-value="value"
              density="compact"
              variant="outlined"
              hide-details
              :prepend-inner-icon="mdiTranslate"
              class="mb-1"
            />
            <div class="d-flex align-center ga-1">
              <v-menu>
                <template #activator="{ props }">
                  <v-btn v-bind="props" variant="text" icon size="small">
                    <v-icon :icon="currentThemeIcon" size="20" />
                  </v-btn>
                </template>
                <v-list density="compact" rounded="lg" elevation="3">
                  <v-list-item
                    v-for="opt in themeOptions"
                    :key="opt.value"
                    :prepend-icon="opt.icon"
                    :title="opt.label"
                    @click="applyTheme(opt.value)"
                  >
                    <template #append>
                      <v-icon v-if="themeMode === opt.value" :icon="mdiCheck" size="18" color="primary" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-spacer />
              <v-btn
                variant="text"
                icon
                size="small"
                color="error"
                :title="t('app.logout')"
                @click="handleLogout"
              >
                <v-icon :icon="mdiLogout" size="20" />
              </v-btn>
            </div>
          </div>
        </template>
      </v-navigation-drawer>

      <!-- 移动端顶栏 -->
      <v-app-bar v-if="isMobile" density="comfortable" color="surface">
        <template #prepend>
          <v-app-bar-nav-icon @click="drawer = !drawer" />
        </template>
        <v-app-bar-title>{{ t('app.title') }}</v-app-bar-title>
        <template #append>
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" variant="text" icon size="small">
                <v-icon :icon="currentThemeIcon" size="20" />
              </v-btn>
            </template>
            <v-list density="compact" rounded="lg" elevation="3">
              <v-list-item
                v-for="opt in themeOptions"
                :key="opt.value"
                :prepend-icon="opt.icon"
                :title="opt.label"
                @click="applyTheme(opt.value)"
              >
                <template #append>
                  <v-icon v-if="themeMode === opt.value" :icon="mdiCheck" size="18" color="primary" />
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
          <v-btn variant="text" icon size="small" color="error" @click="handleLogout">
            <v-icon :icon="mdiLogout" size="20" />
          </v-btn>
        </template>
      </v-app-bar>

      <!-- 主内容区 -->
      <v-main>
        <RouterView />
      </v-main>
    </template>

    <!-- ═══ 未登录态布局 ═══ -->
    <template v-else>
      <v-app-bar v-if="showAuthControls" density="comfortable" color="surface" flat>
        <template #append>
          <v-select
            v-model="selectedLocale"
            :items="localeOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 130px"
            class="mr-2"
          />
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" variant="text" icon size="small">
                <v-icon :icon="currentThemeIcon" size="20" />
              </v-btn>
            </template>
            <v-list density="compact" rounded="lg" elevation="3">
              <v-list-item
                v-for="opt in themeOptions"
                :key="opt.value"
                :prepend-icon="opt.icon"
                :title="opt.label"
                @click="applyTheme(opt.value)"
              >
                <template #append>
                  <v-icon v-if="themeMode === opt.value" :icon="mdiCheck" size="18" color="primary" />
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
        </template>
      </v-app-bar>
      <v-main style="display:flex;align-items:center;justify-content:center;min-height:100vh">
        <RouterView />
      </v-main>
    </template>
  </v-app>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView, useRouter, useRoute } from 'vue-router'
import { useTheme, useDisplay } from 'vuetify'
import { mdiViewDashboardOutline, mdiMessageTextOutline, mdiAccountGroupOutline, mdiShieldCheckOutline, mdiCogOutline, mdiAccountCircleOutline, mdiWeatherSunny, mdiWeatherNight, mdiThemeLightDark, mdiLogout, mdiTranslate, mdiCheck, mdiAccount, mdiLock, mdiKeyVariant, mdiBlockHelper, mdiCheckCircleOutline, mdiDeleteOutline } from '@mdi/js'
import { AUTH_EXPIRED_EVENT, useAuthStore } from './stores/auth'
import { useI18nStore } from './stores/i18n'
import api from './stores/api'

const auth = useAuthStore()
const i18n = useI18nStore()
const router = useRouter()
const route = useRoute()
const vTheme = useTheme()
const { mobile } = useDisplay()

const drawer = ref(true)
const themeMode = ref('system')
const routeReady = ref(false)
const isMobile = computed(() => mobile.value)
const t = i18n.t

let syncLocaleTimer = null
let systemThemeQuery = null

const localeOptions = computed(() => i18n.localeOptions.map((locale) => {
  if (locale === 'zh-hant') return { value: locale, label: t('app.lang.zhHant') }
  if (locale === 'en') return { value: locale, label: t('app.lang.en') }
  return { value: locale, label: t('app.lang.zhHans') }
}))

const themeOptions = computed(() => [
  { value: 'light', label: t('app.themeLight'), icon: mdiWeatherSunny },
  { value: 'dark', label: t('app.themeDark'), icon: mdiWeatherNight },
  { value: 'system', label: t('app.themeSystem'), icon: mdiThemeLightDark },
])

const currentThemeIcon = computed(() => {
  const opt = themeOptions.value.find(o => o.value === themeMode.value)
  return opt?.icon || mdiThemeLightDark
})

const selectedLocale = computed({
  get: () => i18n.locale,
  set: (next) => i18n.setLocale(next),
})

const showAuthControls = computed(() => route.path !== '/login')

const navItems = computed(() => [
  { to: '/', icon: mdiViewDashboardOutline, label: t('nav.dashboard') },
  { to: '/conversations', icon: mdiMessageTextOutline, label: t('nav.conversations') },
  { to: '/users', icon: mdiAccountGroupOutline, label: t('nav.users') },
  { to: '/whitelist', icon: mdiShieldCheckOutline, label: t('nav.whitelist') },
  { to: '/settings', icon: mdiCogOutline, label: t('nav.settings') },
  { to: '/profile', icon: mdiAccountCircleOutline, label: t('nav.profile') },
])

function resolveThemeMode(mode) {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode === 'light' ? 'light' : 'dark'
}

function applyTheme(mode) {
  const normalized = ['light', 'dark', 'system'].includes(mode) ? mode : 'system'
  themeMode.value = normalized
  const resolved = resolveThemeMode(normalized)
  vTheme.global.name.value = resolved === 'light' ? 'lightTheme' : 'darkTheme'
  document.documentElement.classList.toggle('light', resolved === 'light')
  localStorage.setItem('theme_mode', normalized)
  localStorage.setItem('theme', resolved)
}

function handleSystemThemeChange() {
  if (themeMode.value !== 'system') return
  const resolved = resolveThemeMode('system')
  vTheme.global.name.value = resolved === 'light' ? 'lightTheme' : 'darkTheme'
  document.documentElement.classList.toggle('light', resolved === 'light')
  localStorage.setItem('theme', resolved)
}

async function handleAuthExpired() {
  await auth.logout({ skipRequest: true, keepNotice: true })
  if (route.path !== '/login') router.replace('/login')
}

async function syncLocaleToBackend() {
  if (!auth.isLoggedIn) return
  try { await api.put('/api/settings', { BOT_LOCALE: i18n.locale }) } catch {}
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}

onMounted(async () => {
  const savedMode = localStorage.getItem('theme_mode')
  const legacy = localStorage.getItem('theme')
  if (['light', 'dark', 'system'].includes(savedMode)) applyTheme(savedMode)
  else if (legacy === 'light' || legacy === 'dark') applyTheme(legacy)
  else applyTheme('system')

  i18n.setLocale(i18n.locale)
  document.title = t('app.title')

  if (window.matchMedia) {
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeQuery.addEventListener?.('change', handleSystemThemeChange)
  }

  window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  await router.isReady()
  routeReady.value = true
})

onUnmounted(() => {
  if (syncLocaleTimer) clearTimeout(syncLocaleTimer)
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  systemThemeQuery?.removeEventListener?.('change', handleSystemThemeChange)
})

watch(() => route.path, () => { if (isMobile.value) drawer.value = false })

watch(() => i18n.locale, () => {
  document.title = t('app.title')
  if (syncLocaleTimer) clearTimeout(syncLocaleTimer)
  syncLocaleTimer = setTimeout(() => syncLocaleToBackend(), 250)
})
</script>
