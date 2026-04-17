import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
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

async function fetchAuthStatus() {
  try {
    const res = await fetch('/api/auth/status')
    const data = await res.json()
    return !!data.needsRegistration
  } catch {
    return false
  }
}

router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()
  const token = localStorage.getItem('token')

  if (token && !to.meta.public) {
    const ok = await auth.checkAuth()
    if (ok) {
      if (to.meta.public) return next('/')
      return next()
    }
  } else if (auth.isLoggedIn) {
    if (to.meta.public) return next('/')
    return next()
  }

  if (auth.isLoggedIn) {
    if (to.meta.public) return next('/')
    return next()
  }

  const needFirst = await fetchAuthStatus()
  if (needFirst) {
    if (to.path === '/register') return next()
    return next('/register')
  }

  if (to.meta.public) return next()
  return next('/login')
})

export default router
