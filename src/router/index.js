import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { readJsonSafe } from '../utils/http.js'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import RecoverView from '../views/RecoverView.vue'
import DashboardView from '../views/DashboardView.vue'
import ConversationsView from '../views/ConversationsView.vue'
import UsersView from '../views/UsersView.vue'
import WhitelistView from '../views/WhitelistView.vue'
import SettingsView from '../views/SettingsView.vue'
import ProfileView from '../views/ProfileView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'Login', component: LoginView, meta: { public: true } },
    { path: '/register', name: 'Register', component: RegisterView, meta: { public: true } },
    { path: '/recover', name: 'Recover', component: RecoverView, meta: { public: true } },
    { path: '/', name: 'Dashboard', component: DashboardView, meta: { admin: true } },
    { path: '/conversations', name: 'Conversations', component: ConversationsView, meta: { admin: true } },
    { path: '/users', name: 'Users', component: UsersView, meta: { admin: true } },
    { path: '/whitelist', name: 'Whitelist', component: WhitelistView, meta: { admin: true } },
    { path: '/settings', name: 'Settings', component: SettingsView, meta: { admin: true } },
    { path: '/profile', name: 'Profile', component: ProfileView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 首次注册阶段也允许访问的公开页
const AUTH_PUBLIC_PATHS = new Set(['/login', '/register', '/recover'])

async function fetchAuthStatus() {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' })
    const data = await readJsonSafe(res, {})
    return !!data.needsRegistration
  } catch {
    return false
  }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 首次注册页：仅在 needsRegistration 时开放（允许匿名访问）
  if (to.path === '/register') {
    const needFirst = await fetchAuthStatus()
    if (!needFirst) return '/login'
    return true
  }

  // 访问其他公开页：有效会话则回首页
  if (to.meta.public) {
    const ok = await auth.checkAuth()
    if (ok) return '/'
    return true
  }

  const ok = await auth.checkAuth()
  if (ok) {
    // 管理页需要 isAdmin，非管理员平滑重定向至 /profile
    if (to.meta.admin && !auth.isAdmin) return '/profile'
    return true
  }

  // 未登录：默认进入登录页（首次注册可通过登录页链接进入 /register）
  if (to.meta.public || AUTH_PUBLIC_PATHS.has(to.path)) return true
  return '/login'
})

export default router
