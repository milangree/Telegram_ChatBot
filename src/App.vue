<template>
  <div class="app-container">
    <!-- 侧边栏 -->
    <nav class="sidebar" v-if="auth.isLoggedIn">
      <div class="sidebar-header">
        <RouterLink to="/" class="logo-link">
          <span class="logo">🤖</span>
          <span class="logo-text">Bot 管理</span>
        </RouterLink>
      </div>
      <div class="nav-links">
        <RouterLink to="/" class="nav-item">📊 仪表盘</RouterLink>
        <RouterLink to="/conversations" class="nav-item">💬 对话记录</RouterLink>
        <RouterLink to="/users" class="nav-item">👥 用户管理</RouterLink>
        <RouterLink to="/settings" class="nav-item">⚙️ 系统设置</RouterLink>
      </div>
      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar">{{ auth.username?.[0]?.toUpperCase() || 'U' }}</div>
          <span class="user-name">{{ auth.username || '用户' }}</span>
        </div>
        <RouterLink to="/profile" class="icon-btn" title="个人设置">⚙️</RouterLink>
        <button class="icon-btn logout-btn" @click="handleLogout" title="退出">⏻</button>
      </div>
    </nav>
    
    <main class="main-content" :class="{ 'no-sidebar': !auth.isLoggedIn }">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const router = useRouter()

const handleLogout = async () => {
  await auth.logout()
  router.push('/login')
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #0f1117;
  color: #e2e8f0;
}

.app-container {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 260px;
  background: #161b27;
  border-right: 1px solid #2a3248;
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 1px solid #2a3248;
}

.logo-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}

.logo {
  font-size: 24px;
}

.logo-text {
  font-weight: 700;
  font-size: 16px;
}

.nav-links {
  flex: 1;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  padding: 10px 12px;
  border-radius: 8px;
  color: #8b98b4;
  text-decoration: none;
  transition: all 0.2s;
}

.nav-item:hover {
  background: #1e2535;
  color: #e2e8f0;
}

.nav-item.router-link-active {
  background: rgba(79, 142, 247, 0.15);
  color: #4f8ef7;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid #2a3248;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(79, 142, 247, 0.15);
  color: #4f8ef7;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.user-name {
  font-size: 14px;
  color: #8b98b4;
}

.icon-btn {
  background: transparent;
  border: none;
  color: #5a6580;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  font-size: 16px;
  text-decoration: none;
}

.icon-btn:hover {
  background: #1e2535;
  color: #e2e8f0;
}

.logout-btn:hover {
  color: #f74f4f;
}

.main-content {
  flex: 1;
  margin-left: 260px;
  padding: 24px;
  min-height: 100vh;
}

.main-content.no-sidebar {
  margin-left: 0;
}

@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.3s;
  }
  .main-content {
    margin-left: 0;
  }
}
</style>
