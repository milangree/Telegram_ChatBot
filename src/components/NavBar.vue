<template>
  <nav class="sidebar">
    <div class="sidebar-header">
      <RouterLink to="/" class="logo-link">
        <AppIcon name="logo" :size="22" class="logo" />
        <span class="logo-text">{{ t('app.title') }}</span>
      </RouterLink>
    </div>
    <div class="nav-links">
      <RouterLink v-for="i in nav" :key="i.to" :to="i.to" class="nav-item">
        <AppIcon :name="i.icon" :size="18" />
        <span class="nav-label">{{ i.label }}</span>
      </RouterLink>
    </div>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-ava">{{ auth.username[0]?.toUpperCase() }}</div>
        <span class="user-name">{{ auth.username }}</span>
      </div>
      <RouterLink to="/profile" class="profile-btn" :title="t('nav.profile')">
        <AppIcon name="profile" :size="18" />
      </RouterLink>
      <button class="logout-btn" @click="logout" :title="t('app.logout')">
        <AppIcon name="logout" :size="16" />
      </button>
    </div>
  </nav>
</template>
<script setup>
import { RouterLink, useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { useAuthStore } from '../stores/auth.js'
import { useI18nStore } from '../stores/i18n.js'

const auth = useAuthStore(), router = useRouter()
const i18n = useI18nStore()
const t = i18n.t

const nav = [
  { to:'/',              icon:'dashboard', label: t('nav.dashboard') },
  { to:'/conversations', icon:'conversations', label: t('nav.conversations') },
  { to:'/users',         icon:'users', label: t('nav.users') },
  { to:'/settings',      icon:'settings', label: t('nav.settings') },
]
async function logout() { await auth.logout(); router.push('/login') }
</script>
<style scoped>
.sidebar{width:200px;min-width:200px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;height:100vh;position:sticky;top:0}
.sidebar-header{padding:20px 16px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)}
.logo-link{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
.logo{display:inline-flex;align-items:center;justify-content:center}.logo-text{font-weight:700;font-size:15px}
.nav-links{flex:1;padding:12px 8px;display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--rs);color:var(--text2);font-size:13px;font-weight:500;transition:var(--tr);text-decoration:none}
.nav-item:hover{background:var(--bg3);color:var(--text)}
.nav-item.router-link-active{background:var(--accent-dim);color:var(--accent)}
.sidebar-footer{padding:12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px}
.user-info{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
.user-ava{width:30px;height:30px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0}
.user-name{font-size:13px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.profile-btn{display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;cursor:pointer;margin-right:4px;color:var(--text2)}
.logout-btn{display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--text3);border:none;padding:6px;line-height:1;border-radius:var(--rs)}
.logout-btn:hover{color:var(--danger);background:rgba(247,79,79,.1)}
@media(max-width:768px){.sidebar{width:100%;min-width:0;height:auto;flex-direction:row;border-right:none;border-bottom:1px solid var(--border)}.nav-links{flex-direction:row;padding:8px;overflow-x:auto}.nav-label{display:none}.sidebar-header{padding:12px}}
</style>
