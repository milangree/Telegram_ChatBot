<template>
  <div class="app-container" v-if="auth.isLoggedIn">
    <!-- Mobile overlay -->
    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>

    <!-- Sidebar -->
    <nav class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-header">
        <RouterLink to="/" class="logo-link" @click="closeSidebar">
          <span class="logo">🤖</span>
          <span class="logo-text">Bot 管理</span>
        </RouterLink>
        <button class="btn-icon mobile-only" @click="sidebarOpen = false" title="关闭">✕</button>
      </div>

      <div class="nav-links">
        <span class="nav-section">主菜单</span>
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
        <button class="btn-icon" @click="toggleTheme" :title="isDark ? '切换亮色' : '切换暗色'">
          {{ isDark ? '☀️' : '🌙' }}
        </button>
        <button class="btn-icon" @click="handleLogout" title="退出" style="color:var(--danger)">⏻</button>
      </div>
    </nav>

    <!-- Mobile top bar -->
    <div class="mobile-header mobile-only">
      <button class="btn-icon" @click="sidebarOpen = true" title="菜单">☰</button>
      <span class="mobile-title">🤖 Bot 管理</span>
      <button class="btn-icon" @click="toggleTheme" title="切换主题" style="margin-left:auto">{{ isDark ? '☀️' : '🌙' }}</button>
      <button class="btn-icon" @click="handleLogout" title="退出登录" style="color:var(--danger)">⏻</button>
    </div>

    <main class="main-content">
      <RouterView />
    </main>
  </div>

  <!-- Auth pages (login/register etc.) -->
  <div v-else class="main-content no-sidebar">
    <RouterView />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth        = useAuthStore()
const router      = useRouter()
const route       = useRoute()
const sidebarOpen = ref(false)
const isDark      = ref(true)

const navItems = [
  { to: '/',              icon: '📊', label: '仪表盘' },
  { to: '/conversations', icon: '💬', label: '对话记录' },
  { to: '/users',         icon: '👥', label: '用户管理' },
  { to: '/whitelist',     icon: '⚪', label: '白名单' },
  { to: '/settings',      icon: '⚙️', label: '系统设置' },
  { to: '/profile',       icon: '👤', label: '个人设置' },
]

function closeSidebar() { sidebarOpen.value = false }

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('light', !isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
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
})

// Close sidebar on route change
watch(() => route.path, () => { sidebarOpen.value = false })
</script>
