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
        <button class="btn-icon lang-btn" @click="toggleLocale" :title="t('app.language')">
          {{ currentLocaleLabel }}
        </button>
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
      <button class="btn-icon lang-btn" @click="toggleLocale" :title="t('app.language')" style="margin-left:auto">
        {{ currentLocaleLabel }}
      </button>
      <button class="btn-icon" @click="toggleTheme" :title="t('app.toggleTheme')">{{ isDark ? '☀️' : '🌙' }}</button>
      <button class="btn-icon" @click="handleLogout" :title="t('app.logoutLogin')" style="color:var(--danger)">🚪</button>
    </div>

    <main class="main-content">
      <RouterView />
    </main>
  </div>

  <!-- Auth pages (login/register etc.) -->
  <div v-else class="main-content no-sidebar">
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="btn-ghost btn-sm" @click="toggleLocale" :title="t('app.language')">
        {{ currentLocaleLabel }}
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

const t = i18n.t

const currentLocaleLabel = computed(() => {
  if (i18n.locale === 'zh-hant') return t('app.lang.zhHant')
  if (i18n.locale === 'en') return t('app.lang.en')
  return t('app.lang.zhHans')
})

const navItems = computed(() => [
  { to: '/',              icon: '📊', label: t('nav.dashboard') },
  { to: '/conversations', icon: '💬', label: t('nav.conversations') },
  { to: '/users',         icon: '👥', label: t('nav.users') },
  { to: '/whitelist',     icon: '⚪', label: t('nav.whitelist') },
  { to: '/settings',      icon: '⚙️', label: t('nav.settings') },
  { to: '/profile',       icon: '👤', label: t('nav.profile') },
])

function closeSidebar() { sidebarOpen.value = false }

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('light', !isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

let syncLocaleTimer = null

async function syncLocaleToBackend() {
  if (!auth.isLoggedIn) return
  try {
    await api.put('/api/settings', { BOT_LOCALE: i18n.locale })
  } catch {}
}

function toggleLocale() {
  i18n.toggleLocale()
}

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}

onMounted(() => {
  const saved = localStorage.getItem('theme')
  if (saved === 'light') {
    isDark.value = false
    document.documentElement.classList.add('light')
  }
  i18n.setLocale(i18n.locale)
  document.title = t('app.title')
})

// Close sidebar on route change
watch(() => route.path, () => { sidebarOpen.value = false })
watch(() => i18n.locale, () => {
  document.title = t('app.title')
  if (syncLocaleTimer) clearTimeout(syncLocaleTimer)
  syncLocaleTimer = setTimeout(() => { syncLocaleToBackend() }, 250)
})
</script>
