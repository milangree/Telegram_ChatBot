<template>
  <div class="page">
    <h2 class="page-title mb-2">👤 个人设置</h2>

    <!-- Username -->
    <div class="card mb-2">
      <h3 class="sec-title">修改用户名</h3>
      <div class="form-group">
        <label>新用户名</label>
        <input v-model="newUsername" placeholder="字母、数字、下划线，至少3位" />
      </div>
      <div v-if="unameMsg" class="alert" :class="unameOk ? 'alert-success' : 'alert-error'">{{ unameMsg }}</div>
      <button class="btn-primary" @click="changeUsername" :disabled="unameLoading">
        <span v-if="unameLoading" class="spinner"></span>更新用户名
      </button>
    </div>

    <!-- Password -->
    <div class="card mb-2">
      <h3 class="sec-title">修改密码</h3>
      <div class="form-group">
        <label>当前密码</label>
        <input type="password" v-model="oldPw" />
      </div>
      <div class="form-group">
        <label>新密码</label>
        <input type="password" v-model="newPw" placeholder="至少6位" />
      </div>
      <div v-if="pwMsg" class="alert" :class="pwOk ? 'alert-success' : 'alert-error'">{{ pwMsg }}</div>
      <button class="btn-primary" @click="changePassword" :disabled="pwLoading">
        <span v-if="pwLoading" class="spinner"></span>更新密码
      </button>
    </div>

    <!-- 2FA -->
    <div class="card">
      <h3 class="sec-title">两步验证 (2FA)</h3>

      <div v-if="!totpEnabled && !totpSecret">
        <p class="text-muted text-sm mb-2">启用后，登录时可选择「仅用验证码登录」或「密码 + 验证码」两种方式。</p>
        <button class="btn-primary" @click="setup2FA" :disabled="totpLoading">
          <span v-if="totpLoading" class="spinner"></span>启用 2FA
        </button>
      </div>

      <div v-if="totpSecret" class="mt-1">
        <div class="alert alert-info">
          <p>1. 使用 Google Authenticator、Aegis 等应用扫描二维码</p>
          <p>2. 或手动输入密钥：<code style="user-select:all">{{ totpSecret }}</code></p>
        </div>
        <div class="qr-wrap mb-2">
          <img :src="`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`" alt="QR Code" />
        </div>
        <div class="form-group">
          <label>输入应用中的 6 位验证码以启用</label>
          <div class="row-g">
            <input v-model="totpToken" placeholder="123456" maxlength="6" @keydown.enter="verify2FA" />
            <button class="btn-primary" @click="verify2FA" :disabled="totpLoading">
              <span v-if="totpLoading" class="spinner"></span>验证并启用
            </button>
          </div>
        </div>
      </div>

      <div v-if="totpEnabled && !totpSecret">
        <p class="badge badge-success mb-2">✅ 已启用两步验证</p>
        <button class="btn-danger" @click="disable2FA" :disabled="totpLoading">
          <span v-if="totpLoading" class="spinner"></span>禁用 2FA
        </button>
      </div>

      <div v-if="totpMsg" class="alert mt-2" :class="totpOk ? 'alert-success' : 'alert-error'">{{ totpMsg }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../stores/api.js'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()

const newUsername = ref(''),
  unameMsg = ref(''),
  unameOk = ref(true),
  unameLoading = ref(false)
const oldPw = ref(''),
  newPw = ref(''),
  pwMsg = ref(''),
  pwOk = ref(true),
  pwLoading = ref(false)
const totpEnabled = ref(false),
  totpSecret = ref(''),
  qrUrl = ref(''),
  totpToken = ref('')
const totpMsg = ref(''),
  totpOk = ref(true),
  totpLoading = ref(false)

function flash(msgRef, okRef, msg, ok = true, timeout = 4000) {
  msgRef.value = msg
  okRef.value = ok
  if (timeout) setTimeout(() => (msgRef.value = ''), timeout)
}

async function changeUsername() {
  if (!newUsername.value) return
  unameLoading.value = true
  unameMsg.value = ''
  try {
    await api.put('/api/profile/username', { newUsername: newUsername.value })
    flash(unameMsg, unameOk, '✅ 用户名已更新')
    auth.username = newUsername.value
    localStorage.setItem('username', newUsername.value)
    newUsername.value = ''
  } catch (e) {
    flash(unameMsg, unameOk, '❌ ' + e.message, false)
  } finally {
    unameLoading.value = false
  }
}

async function changePassword() {
  if (!oldPw.value || !newPw.value) return
  pwLoading.value = true
  pwMsg.value = ''
  try {
    await api.put('/api/profile/password', { oldPassword: oldPw.value, newPassword: newPw.value })
    flash(pwMsg, pwOk, '✅ 密码已更新')
    oldPw.value = ''
    newPw.value = ''
  } catch (e) {
    flash(pwMsg, pwOk, '❌ ' + e.message, false)
  } finally {
    pwLoading.value = false
  }
}

async function setup2FA() {
  totpLoading.value = true
  totpMsg.value = ''
  try {
    const d = await api.post('/api/profile/2fa/setup', { enable: true })
    totpSecret.value = d.secret
    qrUrl.value = d.qrcode
  } catch (e) {
    flash(totpMsg, totpOk, '❌ ' + e.message, false)
  } finally {
    totpLoading.value = false
  }
}

async function verify2FA() {
  if (!totpToken.value) return
  totpLoading.value = true
  totpMsg.value = ''
  try {
    await api.post('/api/profile/2fa/verify', { token: totpToken.value, secret: totpSecret.value })
    totpEnabled.value = true
    totpSecret.value = ''
    totpToken.value = ''
    flash(totpMsg, totpOk, '✅ 两步验证已启用')
  } catch (e) {
    flash(totpMsg, totpOk, '❌ ' + e.message, false)
  } finally {
    totpLoading.value = false
  }
}

async function disable2FA() {
  if (!confirm('确认禁用两步验证？')) return
  totpLoading.value = true
  totpMsg.value = ''
  try {
    await api.post('/api/profile/2fa/setup', { enable: false })
    totpEnabled.value = false
    flash(totpMsg, totpOk, '✅ 两步验证已禁用')
  } catch (e) {
    flash(totpMsg, totpOk, '❌ ' + e.message, false)
  } finally {
    totpLoading.value = false
  }
}

onMounted(async () => {
  try {
    const d = await api.get('/api/auth/me')
    totpEnabled.value = d.totpEnabled
    auth.username = d.username
    newUsername.value = d.username
  } catch {
    /* noop */
  }
})
</script>

<style scoped>
.page {
  max-width: 540px;
  margin: 0 auto;
}
.qr-wrap {
  display: flex;
  justify-content: center;
}
.qr-wrap img {
  border-radius: 8px;
  border: 4px solid var(--bg2);
}
</style>
