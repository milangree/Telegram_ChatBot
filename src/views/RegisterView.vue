<template>
  <div class="auth-page">
    <div class="auth-card card">
      <div class="login-logo">🤖</div>
<<<<<<< HEAD
      <h1 class="login-title">首次联系配置</h1>
      <div class="alert alert-info mb-2">首次联系完成后将关闭该入口，并禁用默认账号，请妥善保管账号密码。</div>
=======
      <h1 class="login-title">首次注册管理员</h1>
      <div class="alert alert-info mb-2">注册完成后将关闭注册入口，请妥善保管账号密码。</div>
>>>>>>> 1f4b014bea61d272db421d42e0c09bd79c6e9ba8
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="form-group">
        <label>用户名</label>
        <input v-model="username" placeholder="至少3个字符" autocomplete="username" />
      </div>
      <div class="form-group">
        <label>密码</label>
        <input v-model="password" type="password" placeholder="至少6个字符" autocomplete="new-password" />
      </div>
      <button class="btn-primary w-full" @click="doRegister" :disabled="loading">
<<<<<<< HEAD
        <span v-if="loading" class="spinner"></span>{{ loading ? '提交中…' : '完成首次联系' }}
=======
        <span v-if="loading" class="spinner"></span>{{ loading ? '注册中…' : '注册' }}
>>>>>>> 1f4b014bea61d272db421d42e0c09bd79c6e9ba8
      </button>
      <div style="margin-top:12px;text-align:center">
        <RouterLink to="/login" class="text-sm">← 已有账号，登录</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const auth     = useAuthStore()
const router   = useRouter()
const username = ref(''), password = ref(''), loading = ref(false), error = ref('')

async function doRegister() {
  if (!username.value || !password.value) { error.value = '请填写所有字段'; return }
  loading.value = true; error.value = ''
  try {
    const res  = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: username.value, password: password.value }) })
    const data = await res.json()
<<<<<<< HEAD
    if (!res.ok) throw new Error(data.error || '首次联系失败')
=======
    if (!res.ok) throw new Error(data.error || '注册失败')
>>>>>>> 1f4b014bea61d272db421d42e0c09bd79c6e9ba8
    auth.token = data.token; auth.username = data.username; auth.isAdmin = true
    localStorage.setItem('token', data.token); localStorage.setItem('username', data.username); localStorage.setItem('isAdmin', 'true')
    router.push('/')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>

<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-card{width:100%;max-width:380px;padding:36px 28px}
.login-logo{font-size:44px;text-align:center;margin-bottom:12px}
.login-title{font-size:20px;font-weight:700;text-align:center;margin-bottom:20px}
</style>
