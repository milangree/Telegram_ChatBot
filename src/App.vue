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
        <!-- Theme toggle -->
        <select class="lang-select" v-model="selectedLocale" :title="t('app.language')">
          <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <button class="btn-icon" @click="toggleTheme" :title="isDark ? t('app.toggleLight') : t('app.toggleDark')">
          {{ isDark ? '☀️' : '🌙' }}
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
      <button class="btn-icon" @click="toggleTheme" :title="t('app.toggleTheme')">{{ isDark ? '☀️' : '🌙' }}</button>
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
      <button class="btn-icon" @click="toggleTheme" :title="isDark ? t('app.toggleLight') : t('app.toggleDark')">
        {{ isDark ? '☀️' : '🌙' }}
      </button>
    </div>
    <RouterView />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useI18nStore } from './stores/i18n'
import api from './stores/api'

const auth        = useAuthStore()
const i18n        = useI18nStore()
const router      = useRouter()
const route       = useRoute()
const sidebarOpen = ref(false)
const isDark      = ref(true)
const routeReady  = ref(false)

const t = i18n.t

const localeOptions = computed(() => i18n.localeOptions.map((locale) => {
  if (locale === 'zh-hant') return { value: locale, label: t('app.lang.zhHant') }
  if (locale === 'en') return { value: locale, label: t('app.lang.en') }
  return { value: locale, label: t('app.lang.zhHans') }
}))

const selectedLocale = computed({
  get: () => i18n.locale,
  set: (next) => i18n.setLocale(next),
})

const showAuthControls = computed(() => route.path !== '/login')

const navItems = computed(() => [
  { to: '/',              icon: '📊', label: t('nav.dashboard') },
  { to: '/conversations', icon: '💬', label: t('nav.conversations') },
  { to: '/users',         icon: '👥', label: t('nav.users') },
  { to: '/whitelist',     icon: '⚪', label: t('nav.whitelist') },
  { to: '/settings',      icon: '⚙️', label: t('nav.settings') },
  { to: '/profile',       icon: '👤', label: t('nav.profile') },
])

function closeSidebar() { sidebarOpen.value = false }

function applyTheme(mode) {
  isDark.value = mode !== 'light'
  document.documentElement.classList.toggle('light', mode === 'light')
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

function toggleTheme() {
  applyTheme(isDark.value ? 'light' : 'dark')
}

let syncLocaleTimer = null

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
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved)
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    applyTheme(prefersDark ? 'dark' : 'light')
  }
  i18n.setLocale(i18n.locale)
  document.title = t('app.title')
  await router.isReady()
  routeReady.value = true
})

// Close sidebar on route change
watch(() => route.path, () => { sidebarOpen.value = false })
watch(() => i18n.locale, () => {
  document.title = t('app.title')
  if (syncLocaleTimer) clearTimeout(syncLocaleTimer)
  syncLocaleTimer = setTimeout(() => { syncLocaleToBackend() }, 250)
})
</script>
