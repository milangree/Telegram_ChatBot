<template>
  <nav class="sidebar">
    <div class="sidebar-header">
      <RouterLink to="/" class="logo-link">
        <span class="logo">🤖</span>
        <span class="logo-text">Bot 管理</span>
      </RouterLink>
    </div>
    <div class="nav-links">
      <RouterLink v-for="i in nav" :key="i.to" :to="i.to" class="nav-item">
        <span>{{ i.icon }}</span><span class="nav-label">{{ i.label }}</span>
      </RouterLink>
    </div>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-ava">{{ auth.username[0]?.toUpperCase() }}</div>
        <span class="user-name">{{ auth.username }}</span>
      </div>
      <RouterLink to="/profile" class="profile-btn" title="个人设置">⚙️</RouterLink>
      <button class="logout-btn" @click="logout" title="退出">🚪</button>
    </div>
  </nav>
</template>
<script setup>
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
const auth = useAuthStore(), router = useRouter()
const nav = [
  { to:'/',              icon:'📊', label:'仪表盘' },
  { to:'/conversations', icon:'💬', label:'对话记录' },
  { to:'/users',         icon:'👥', label:'用户管理' },
  { to:'/settings',      icon:'⚙️', label:'系统设置' },
]
async function logout() { await auth.logout(); router.push('/login') }
</script>
<style scoped>
.sidebar{width:200px;min-width:200px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;height:100vh;position:sticky;top:0}
.sidebar-header{padding:20px 16px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)}
.logo-link{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
.logo{font-size:22px}.logo-text{font-weight:700;font-size:15px}
.nav-links{flex:1;padding:12px 8px;display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--rs);color:var(--text2);font-size:13px;font-weight:500;transition:var(--tr);text-decoration:none}
.nav-item:hover{background:var(--bg3);color:var(--text)}
.nav-item.router-link-active{background:var(--accent-dim);color:var(--accent)}
.sidebar-footer{padding:12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px}
.user-info{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
.user-ava{width:30px;height:30px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0}
.user-name{font-size:13px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.profile-btn{background:transparent;border:none;font-size:18px;cursor:pointer;margin-right:4px;color:var(--text2)}
.logout-btn{background:transparent;color:var(--text3);border:none;padding:6px;font-size:16px;line-height:1;border-radius:var(--rs)}
.logout-btn:hover{color:var(--danger);background:rgba(247,79,79,.1)}
@media(max-width:768px){.sidebar{width:100%;min-width:0;height:auto;flex-direction:row;border-right:none;border-bottom:1px solid var(--border)}.nav-links{flex-direction:row;padding:8px;overflow-x:auto}.nav-label{display:none}.sidebar-header{padding:12px}}
</style>
