// src/stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const username = ref('')
  const isAdmin = ref(false)
  
  const isLoggedIn = computed(() => !!token.value)

  // 初始化
  const init = () => {
    const storedToken = localStorage.getItem('token')
    const storedUsername = localStorage.getItem('username')
    const storedIsAdmin = localStorage.getItem('isAdmin') === 'true'
    
    if (storedToken) {
      token.value = storedToken
      username.value = storedUsername || ''
      isAdmin.value = storedIsAdmin
    }
  }
  
  init()

  async function login(usernameInput, passwordInput) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || '登录失败')
    }
    
    token.value = data.token
    username.value = data.username
    isAdmin.value = data.isAdmin || false
    
    localStorage.setItem('token', data.token)
    localStorage.setItem('username', data.username)
    localStorage.setItem('isAdmin', String(data.isAdmin || false))
    
    return data
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (e) {
      console.error('Logout error:', e)
    }
    
    token.value = ''
    username.value = ''
    isAdmin.value = false
    
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('isAdmin')
  }

  async function checkAuth() {
    const storedToken = localStorage.getItem('token')
    if (!storedToken) return false
    
    try {
      const response = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${storedToken}` }
      })
      
      if (!response.ok) throw new Error('Auth failed')
      
      const data = await response.json()
      token.value = storedToken
      username.value = data.username
      isAdmin.value = data.isAdmin
      return true
    } catch (e) {
      logout()
      return false
    }
  }

  return { token, username, isAdmin, isLoggedIn, login, logout, checkAuth, init }
})
