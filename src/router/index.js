import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login',      name: 'Login',         component: () => import('../views/LoginView.vue'),         meta: { public: true } },
    { path: '/register',   name: 'Register',       component: () => import('../views/RegisterView.vue'),      meta: { public: true } },
    { path: '/recover',    name: 'Recover',        component: () => import('../views/RecoverView.vue'),       meta: { public: true } },
    { path: '/',           name: 'Dashboard',      component: () => import('../views/DashboardView.vue') },
    { path: '/conversations', name: 'Conversations', component: () => import('../views/ConversationsView.vue') },
    { path: '/users',      name: 'Users',          component: () => import('../views/UsersView.vue') },
    { path: '/whitelist',  name: 'Whitelist',      component: () => import('../views/WhitelistView.vue') },
    { path: '/settings',   name: 'Settings',       component: () => import('../views/SettingsView.vue') },
    { path: '/profile',    name: 'Profile',        component: () => import('../views/ProfileView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to, from, next) => {
  const auth  = useAuthStore()
  const token = localStorage.getItem('token')
  if (token && !auth.isLoggedIn) await auth.checkAuth()
  if (to.meta.public) {
    if (auth.isLoggedIn && (to.path === '/login' || to.path === '/register')) return next('/')
    return next()
  }
  if (!auth.isLoggedIn) return next('/login')
  next()
})

export default router
