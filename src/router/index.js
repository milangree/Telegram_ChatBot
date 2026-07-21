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
    { path: '/', name: 'Dashboard', component: DashboardView },
    { path: '/conversations', name: 'Conversations', component: ConversationsView },
    { path: '/users', name: 'Users', component: UsersView },
    { path: '/whitelist', name: 'Whitelist', component: WhitelistView },
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

  // 首次注册页必须由已登录的初始管理员访问，不能匿名抢注。
  if (to.path === '/register') {
    const needFirst = await fetchAuthStatus()
    if (!needFirst) return '/login'
    const ok = await auth.checkAuth()
    return ok ? true : '/login'
  }

  // 访问其他公开页：有效会话则回首页
  if (to.meta.public) {
    const ok = await auth.checkAuth()
    if (ok) return '/'
    return true
  }

  const ok = await auth.checkAuth()
  if (ok) {
    // 管理页需要 isAdmin
    if (to.meta.admin && !auth.isAdmin) return '/'
    return true
  }

  // 未登录：首次注册阶段也先登录初始管理员，再进入 /register
  if (await fetchAuthStatus()) return '/login'

  if (to.meta.public || AUTH_PUBLIC_PATHS.has(to.path)) return true
  return '/login'
})

export default router
