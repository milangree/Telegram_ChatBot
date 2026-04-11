<template>
  <div class="auth-page">
    <div class="auth-card card">
      <h1 class="login-title">🔑 找回密码</h1>
      <div class="alert alert-info mb-2">需要账号已启用两步验证 (2FA) 才能通过此方式找回密码。</div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div v-if="success" class="alert alert-success">✅ 密码已重置，正在跳转登录…</div>

      <div class="form-group">
        <label>用户名</label>
        <input v-model="username" placeholder="用户名" />
      </div>
      <div class="form-group">
        <label>两步验证码</label>
        <input v-model="totp" placeholder="Authenticator 6位码" maxlength="6" />
      </div>
      <div class="form-group">
        <label>新密码</label>
        <input v-model="newPassword" type="password" placeholder="至少6位" />
      </div>
      <button class="btn-primary w-full" @click="doRecover" :disabled="loading">
        <span v-if="loading" class="spinner"></span>{{ loading ? '重置中…' : '重置密码' }}
      </button>
      <div style="margin-top:12px;text-align:center">
        <RouterLink to="/login" class="text-sm">← 返回登录</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import api from '../stores/api.js'

const router      = useRouter()
const username    = ref(''), totp = ref(''), newPassword = ref('')
const loading     = ref(false), error = ref(''), success = ref(false)

async function doRecover() {
  if (!username.value || !totp.value || !newPassword.value) { error.value = '请填写所有字段'; return }
  loading.value = true; error.value = ''
  try {
    await api.post('/api/auth/recover', { username: username.value, totp: totp.value, newPassword: newPassword.value })
    success.value = true
    setTimeout(() => router.push('/login'), 1500)
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>

<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-card{width:100%;max-width:380px;padding:36px 28px}
.login-title{font-size:20px;font-weight:700;text-align:center;margin-bottom:20px}
</style>
