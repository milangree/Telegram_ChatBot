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
    { path: '/settings', name: 'Settings', component: SettingsView },
    { path: '/profile', name: 'Profile', component: ProfileView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 首次注册阶段也允许访问的公开页（可用默认 admin 登录，不必强制卡在注册页）
const AUTH_PUBLIC_PATHS = new Set(['/login', '/register', '/recover'])

async function fetchAuthStatus() {
  try {
    const res = await fetch('/api/auth/status')
    const data = await readJsonSafe(res, {})
    return !!data.needsRegistration
  } catch {
    return false
  }
}

router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()
  const token = localStorage.getItem('token')

  // 已有 token：校验会话
  if (token) {
    // 访问公开页时，若会话仍有效则回首页；无效则清状态并继续去公开页
    if (to.meta.public) {
      const ok = await auth.checkAuth()
      if (ok) return next('/')
      return next()
    }

    const ok = await auth.checkAuth()
    if (ok) return next()
    // token 失效后落到下方未登录逻辑
  } else if (auth.isLoggedIn) {
    // 内存状态有登录但本地 token 已丢：重置后按未登录处理
    auth.resetState()
  }

  // 未登录访问受保护页 / 公开页
  const needFirst = await fetchAuthStatus()
  if (needFirst) {
    // 允许 login / register / recover 互相跳转；其它路径引导去注册
    if (AUTH_PUBLIC_PATHS.has(to.path)) return next()
    return next('/register')
  }

  if (to.meta.public || AUTH_PUBLIC_PATHS.has(to.path)) return next()
  return next('/login')
})

export default router
