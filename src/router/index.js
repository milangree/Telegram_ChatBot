import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const LoginView = () => import('../views/LoginView.vue')
const DashboardView = () => import('../views/DashboardView.vue')
const ConversationsView = () => import('../views/ConversationsView.vue')
const UsersView = () => import('../views/UsersView.vue')
const SettingsView = () => import('../views/SettingsView.vue')
const ProfileView = () => import('../views/ProfileView.vue')

const routes = [
  { path: '/login', name: 'Login', component: LoginView, meta: { public: true } },
  { path: '/', name: 'Dashboard', component: DashboardView },
  { path: '/conversations', name: 'Conversations', component: ConversationsView },
  { path: '/users', name: 'Users', component: UsersView },
  { path: '/settings', name: 'Settings', component: SettingsView },
  { path: '/profile', name: 'Profile', component: ProfileView },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()
  const token = localStorage.getItem('token')
  
  // 如果有 token 但 store 中没有，尝试恢复
  if (token && !auth.isLoggedIn) {
    await auth.checkAuth()
  }
  
  if (to.meta.public) {
    if (auth.isLoggedIn && to.path === '/login') {
      return next('/')
    }
    return next()
  }
  
  if (!auth.isLoggedIn) {
    return next('/login')
  }
  
  next()
})

export default router
