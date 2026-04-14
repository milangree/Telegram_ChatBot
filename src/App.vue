<template>
  <div class="app-container" v-if="auth.isLoggedIn">
    <!-- Mobile overlay -->
    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>

    <!-- Sidebar -->
    <nav class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-header">
        <RouterLink to="/" class="logo-link" @click="closeSidebar">
          <span class="logo">🤖</span>
          <span class="logo-text">{{ t('app.title') }}</span>
        </RouterLink>
        <button class="btn-icon mobile-only" @click="sidebarOpen = false" :title="t('app.close')">✕</button>
      </div>

      <div class="nav-links">
        <span class="nav-section">{{ t('app.mainMenu') }}</span>
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-item" @click="closeSidebar">
          <span>{{ item.icon }}</span><span>{{ item.label }}</span>
        </RouterLink>
      </div>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-ava">{{ auth.username?.[0]?.toUpperCase() || 'U' }}</div>
          <span class="user-name">{{ auth.username }}</span>
        </div>
        <select class="lang-select" v-model="selectedLocale" :title="t('app.language')">
          <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <div class="theme-menu-wrap">
          <button class="btn-icon theme-trigger" @click.stop="toggleThemeMenu" :title="t('app.toggleTheme')">
            {{ currentThemeOption.icon }}
          </button>
          <div v-if="themeMenuOpen" class="theme-menu">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              class="theme-menu-item"
              :class="{ active: themeMode === option.value }"
              @click.stop="applyTheme(option.value)"
            >
              <span class="theme-menu-icon">{{ option.icon }}</span>
              <span class="theme-menu-label">{{ option.label }}</span>
              <span class="theme-menu-check">{{ themeMode === option.value ? '✓' : '' }}</span>
            </button>
          </div>
        </div>
        <button class="btn-icon glass-toggle-btn" @click="toggleGlass" :title="glassEnabled ? t('app.disableGlass') : t('app.enableGlass')">
          <span class="glass-toggle-icon" :class="{ active: glassEnabled }" aria-hidden="true"></span>
        </button>
        <button class="btn-icon" @click="handleLogout" :title="t('app.logout')" style="color:var(--danger)">🚪</button>
      </div>
    </nav>

    <!-- Mobile top bar -->
    <div class="mobile-header mobile-only">
      <button class="btn-icon" @click="sidebarOpen = true" :title="t('app.menu')">☰</button>
      <span class="mobile-title">🤖 {{ t('app.title') }}</span>
      <select class="lang-select" v-model="selectedLocale" :title="t('app.language')" style="margin-left:auto">
        <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <div class="theme-menu-wrap">
        <button class="btn-icon theme-trigger" @click.stop="toggleThemeMenu" :title="t('app.toggleTheme')">
          {{ currentThemeOption.icon }}
        </button>
        <div v-if="themeMenuOpen" class="theme-menu">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            class="theme-menu-item"
            :class="{ active: themeMode === option.value }"
            @click.stop="applyTheme(option.value)"
          >
            <span class="theme-menu-icon">{{ option.icon }}</span>
            <span class="theme-menu-label">{{ option.label }}</span>
            <span class="theme-menu-check">{{ themeMode === option.value ? '✓' : '' }}</span>
          </button>
        </div>
      </div>
      <button class="btn-icon glass-toggle-btn" @click="toggleGlass" :title="glassEnabled ? t('app.disableGlass') : t('app.enableGlass')">
        <span class="glass-toggle-icon" :class="{ active: glassEnabled }" aria-hidden="true"></span>
      </button>
      <button class="btn-icon" @click="handleLogout" :title="t('app.logoutLogin')" style="color:var(--danger)">🚪</button>
    </div>

    <main class="main-content">
      <RouterView />
    </main>
  </div>

  <!-- Auth pages (login/register etc.) -->
  <div v-else class="main-content no-sidebar">
    <div v-if="routeReady && showAuthControls" class="auth-topbar">
      <select class="lang-select auth-lang-select" v-model="selectedLocale" :title="t('app.language')">
        <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <div class="theme-menu-wrap">
        <button class="btn-icon theme-trigger" @click.stop="toggleThemeMenu" :title="t('app.toggleTheme')">
          {{ currentThemeOption.icon }}
        </button>
        <div v-if="themeMenuOpen" class="theme-menu">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            class="theme-menu-item"
            :class="{ active: themeMode === option.value }"
            @click.stop="applyTheme(option.value)"
          >
            <span class="theme-menu-icon">{{ option.icon }}</span>
            <span class="theme-menu-label">{{ option.label }}</span>
            <span class="theme-menu-check">{{ themeMode === option.value ? '✓' : '' }}</span>
          </button>
        </div>
      </div>
      <button class="btn-icon glass-toggle-btn" @click="toggleGlass" :title="glassEnabled ? t('app.disableGlass') : t('app.enableGlass')">
        <span class="glass-toggle-icon" :class="{ active: glassEnabled }" aria-hidden="true"></span>
      </button>
    </div>
    <RouterView />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useI18nStore } from './stores/i18n'
import api from './stores/api'

const auth = useAuthStore()
const i18n = useI18nStore()
const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)
const isDark = ref(true)
const glassEnabled = ref(false)
const routeReady = ref(false)
const themeMode = ref('system')
const themeMenuOpen = ref(false)

const t = i18n.t

let syncLocaleTimer = null
let systemThemeQuery = null

const localeOptions = computed(() => i18n.localeOptions.map((locale) => {
  if (locale === 'zh-hant') return { value: locale, label: t('app.lang.zhHant') }
  if (locale === 'en') return { value: locale, label: t('app.lang.en') }
  return { value: locale, label: t('app.lang.zhHans') }
}))

const themeOptions = computed(() => [
  { value: 'light', label: t('app.themeLight'), icon: '☀️' },
  { value: 'dark', label: t('app.themeDark'), icon: '🌙' },
  { value: 'system', label: t('app.themeSystem'), icon: '🖥️' },
])

const currentThemeOption = computed(() => (
  themeOptions.value.find((option) => option.value === themeMode.value) || themeOptions.value[2]
))

const selectedLocale = computed({
  get: () => i18n.locale,
  set: (next) => i18n.setLocale(next),
})

const showAuthControls = computed(() => route.path !== '/login')

const navItems = computed(() => [
  { to: '/', icon: '📊', label: t('nav.dashboard') },
  { to: '/conversations', icon: '💬', label: t('nav.conversations') },
  { to: '/users', icon: '👥', label: t('nav.users') },
  { to: '/whitelist', icon: '⚪', label: t('nav.whitelist') },
  { to: '/settings', icon: '⚙️', label: t('nav.settings') },
  { to: '/profile', icon: '👤', label: t('nav.profile') },
])

function closeSidebar() {
  sidebarOpen.value = false
}

function toggleThemeMenu() {
  themeMenuOpen.value = !themeMenuOpen.value
}

function closeThemeMenu() {
  themeMenuOpen.value = false
}

function resolveThemeMode(mode) {
  if (mode === 'system') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? 'dark' : 'light'
  }
  return mode === 'light' ? 'light' : 'dark'
}

function applyResolvedTheme(resolved) {
  isDark.value = resolved !== 'light'
  document.documentElement.classList.toggle('light', resolved === 'light')
}

function applyTheme(mode) {
  const normalized = ['light', 'dark', 'system'].includes(mode) ? mode : 'system'
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

async function syncLocaleToBackend() {
  if (!auth.isLoggedIn) return
  try {
    await api.put('/api/settings', { BOT_LOCALE: i18n.locale })
  } catch {}
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}

onMounted(async () => {
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
  i18n.setLocale(i18n.locale)
  document.title = t('app.title')

  if (window.matchMedia) {
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', handleSystemThemeChange)
    else if (systemThemeQuery.addListener) systemThemeQuery.addListener(handleSystemThemeChange)
  }

  document.addEventListener('click', closeThemeMenu)

  await router.isReady()
  routeReady.value = true
})

onUnmounted(() => {
  if (syncLocaleTimer) clearTimeout(syncLocaleTimer)
  document.removeEventListener('click', closeThemeMenu)

  if (systemThemeQuery?.removeEventListener) systemThemeQuery.removeEventListener('change', handleSystemThemeChange)
  else if (systemThemeQuery?.removeListener) systemThemeQuery.removeListener(handleSystemThemeChange)
})

// Close sidebar on route change
watch(() => route.path, () => {
  sidebarOpen.value = false
  closeThemeMenu()
})

watch(() => i18n.locale, () => {
  document.title = t('app.title')
  if (syncLocaleTimer) clearTimeout(syncLocaleTimer)
  syncLocaleTimer = setTimeout(() => { syncLocaleToBackend() }, 250)
})
</script>
