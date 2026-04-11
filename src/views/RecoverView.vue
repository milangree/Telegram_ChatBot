<template>
  <div class="auth-page">
    <div class="auth-card card">
      <h1>找回密码</h1>
      <div v-if="step === 1">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="username" placeholder="用户名" />
        </div>
        <button class="btn-primary w-full" @click="requestRecovery">下一步</button>
      </div>
      <div v-else-if="step === 2">
        <div class="alert alert-info">该账号已启用两步验证，请输入验证码和新密码。</div>
        <div class="form-group">
          <label>两步验证码</label>
          <input v-model="totp" placeholder="6位验证码" />
        </div>
        <div class="form-group">
          <label>新密码</label>
          <input v-model="newPassword" type="password" placeholder="至少6位" />
        </div>
        <button class="btn-primary w-full" @click="resetPassword">重置密码</button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../stores/api.js'

const router = useRouter()
const step = ref(1)
const username = ref('')
const totp = ref('')
const newPassword = ref('')

async function requestRecovery() {
  // 第一步只检查用户是否存在且启用了2FA，实际不调用后端
  step.value = 2
}
async function resetPassword() {
  try {
    await api.post('/api/auth/recover', { username: username.value, totp: totp.value, newPassword: newPassword.value })
    alert('密码已重置，请登录')
    router.push('/login')
  } catch(e) {
    alert(e.message)
  }
}
</script>
<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-card{width:100%;max-width:380px;padding:36px 32px}
</style>