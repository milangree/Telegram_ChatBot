<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-logo">🤖</div>
      <h1 class="login-title">Bot 管理后台</h1>
      <p class="login-subtitle">请登录以继续</p>
      
      <div v-if="error" class="error-message">{{ error }}</div>
      
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <input 
            v-model="username" 
            type="text" 
            placeholder="用户名" 
            required
            autocomplete="username"
          />
        </div>
        <div class="form-group">
          <input 
            v-model="password" 
            type="password" 
            placeholder="密码" 
            required
            autocomplete="current-password"
          />
        </div>
        <button type="submit" class="login-btn" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
      
      <div class="login-footer">
        默认账号: admin / admins
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  
  error.value = ''
  loading.value = true
  
  try {
    await auth.login(username.value, password.value)
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f1117;
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 380px;
  background: #161b27;
  border: 1px solid #2a3248;
  border-radius: 16px;
  padding: 40px 32px;
}

.login-logo {
  font-size: 48px;
  text-align: center;
  margin-bottom: 16px;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 8px;
  color: #e2e8f0;
}

.login-subtitle {
  font-size: 13px;
  text-align: center;
  color: #8b98b4;
  margin-bottom: 28px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group input {
  width: 100%;
  padding: 12px 14px;
  background: #1e2535;
  border: 1px solid #2a3248;
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 14px;
  outline: none;
}

.form-group input:focus {
  border-color: #4f8ef7;
  box-shadow: 0 0 0 3px rgba(79, 142, 247, 0.15);
}

.login-btn {
  width: 100%;
  padding: 12px;
  background: #4f8ef7;
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}

.login-btn:hover {
  background: #6ba3ff;
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  background: rgba(247, 79, 79, 0.12);
  border: 1px solid rgba(247, 79, 79, 0.3);
  color: #f74f4f;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 20px;
}

.login-footer {
  margin-top: 20px;
  text-align: center;
  font-size: 12px;
  color: #5a6580;
}
</style>
