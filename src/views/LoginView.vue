<template>
  <div class="login-wrap">
    <div class="login-card card">
      <div class="login-logo">🤖</div>
      <h1 class="login-title">Bot 管理后台</h1>

      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <!-- Username field (shared) -->
      <div class="form-group" v-if="step === 'username' || step === 'password' || step === 'totp_only'">
        <label>用户名</label>
        <input v-model="username" placeholder="用户名" autocomplete="username"
          @keydown.enter="step === 'username' ? checkUsername() : null" />
      </div>

      <!-- Step 1: enter username only, then we detect if TOTP is enabled -->
      <div v-if="step === 'username'">
        <button class="btn-primary w-full" :disabled="loading" @click="checkUsername">
          <span v-if="loading" class="spinner"></span>{{ loading ? '检查中…' : '下一步' }}
        </button>
        <div class="login-links">
          <RouterLink to="/register">首次注册</RouterLink>
          <RouterLink to="/recover">找回密码</RouterLink>
        </div>
      </div>

      <!-- Step 2a: password (+ optional TOTP) -->
      <div v-else-if="step === 'password'">
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" type="password" placeholder="密码" autocomplete="current-password"
            @keydown.enter="handleLogin" />
        </div>
        <div class="form-group" v-if="totpEnabled">
          <label>两步验证码 <span class="text-muted">(6位)</span></label>
          <input v-model="totp" placeholder="123456" maxlength="6" @keydown.enter="handleLogin" />
        </div>
        <button class="btn-primary w-full" :disabled="loading" @click="handleLogin">
          <span v-if="loading" class="spinner"></span>{{ loading ? '登录中…' : '登录' }}
        </button>
        <div style="margin-top:10px;text-align:center">
          <button class="btn-ghost btn-sm" @click="step = 'username'">← 返回</button>
          <button v-if="totpEnabled" class="btn-ghost btn-sm" style="margin-left:8px" @click="step = 'totp_only'">
            仅用验证码登录
          </button>
        </div>
      </div>

      <!-- Step 2b: TOTP-only login -->
      <div v-else-if="step === 'totp_only'">
        <div class="alert alert-info">使用 Authenticator 验证码直接登录（无需密码）</div>
        <div class="form-group">
          <label>两步验证码 <span class="text-muted">(6位)</span></label>
          <input v-model="totp" placeholder="123456" maxlength="6" @keydown.enter="handleLoginTotp" />
        </div>
        <button class="btn-primary w-full" :disabled="loading" @click="handleLoginTotp">
          <span v-if="loading" class="spinner"></span>{{ loading ? '登录中…' : '验证登录' }}
        </button>
        <div style="margin-top:10px;text-align:center">
          <button class="btn-ghost btn-sm" @click="step = 'password'">← 密码登录</button>
        </div>
      </div>

      <div class="login-footer">默认账号：admin / admins</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth     = useAuthStore()
const router   = useRouter()
const step     = ref('username')
const username = ref('')
const password = ref('')
const totp     = ref('')
const loading  = ref(false)
const error    = ref('')
const totpEnabled = ref(false)

async function checkUsername() {
  if (!username.value.trim()) { error.value = '请输入用户名'; return }
  loading.value = true; error.value = ''
  try {
    const res = await fetch('/api/auth/totp-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value }),
    })
    const data = await res.json()
    totpEnabled.value = data.totpEnabled
    step.value = 'password'
  } catch { step.value = 'password' }
  finally { loading.value = false }
}

async function handleLogin() {
  if (!password.value) { error.value = '请输入密码'; return }
  loading.value = true; error.value = ''
  try {
    await auth.login(username.value, password.value, totp.value || undefined)
    router.push('/')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

async function handleLoginTotp() {
  if (!totp.value) { error.value = '请输入验证码'; return }
  loading.value = true; error.value = ''
  try {
    await auth.loginTotp(username.value, totp.value)
    router.push('/')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>

<style scoped>
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.login-card{width:100%;max-width:380px;padding:36px 28px}
.login-logo{font-size:44px;text-align:center;margin-bottom:12px}
.login-title{font-size:21px;font-weight:700;text-align:center;margin-bottom:22px}
.login-links{margin-top:14px;display:flex;justify-content:space-between;font-size:13px}
.login-footer{margin-top:20px;text-align:center;font-size:12px;color:var(--text3)}
</style>
