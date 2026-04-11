<template>
  <div class="page">
    <h2 class="page-title">👤 个人设置</h2>
    <div class="card">
      <h3>修改密码</h3>
      <div class="form-group">
        <label>当前密码</label>
        <input type="password" v-model="oldPw" />
      </div>
      <div class="form-group">
        <label>新密码</label>
        <input type="password" v-model="newPw" />
      </div>
      <button class="btn-primary" @click="changePassword">更新密码</button>
    </div>

    <div class="card mt-2">
      <h3>两步验证 (2FA)</h3>
      <div v-if="!totpEnabled">
        <button class="btn-primary" @click="setup2FA">启用 2FA</button>
      </div>
      <div v-else>
        <p>✅ 已启用两步验证</p>
        <button class="btn-danger" @click="disable2FA">禁用 2FA</button>
      </div>

      <div v-if="totpSecret" class="mt-2">
        <div class="alert alert-info">
          <p>1. 使用 Google Authenticator 或类似应用扫描二维码</p>
          <p>2. 或手动输入密钥：<code>{{ totpSecret }}</code></p>
        </div>
        <div class="qr-wrapper">
          <img :src="qrUrl" alt="QR Code" />
        </div>
        <div class="form-group mt-2">
          <label>输入应用中的6位验证码以启用</label>
          <div class="row-g">
            <input v-model="totpToken" placeholder="123456" />
            <button class="btn-primary" @click="verify2FA">验证并启用</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../stores/api.js'

const oldPw = ref('')
const newPw = ref('')
const totpEnabled = ref(false)
const totpSecret = ref('')
const qrUrl = ref('')
const totpToken = ref('')

async function changePassword() {
  try {
    await api.put('/api/profile/password', { oldPassword: oldPw.value, newPassword: newPw.value })
    alert('密码已更新')
    oldPw.value = ''
    newPw.value = ''
  } catch (e) {
    alert(e.message)
  }
}

async function setup2FA() {
  try {
    const res = await api.post('/api/profile/2fa/setup', { enable: true })
    totpSecret.value = res.secret
    // 使用 quickchart.io 生成二维码（免费，无需 API key）
    qrUrl.value = `https://quickchart.io/qr?text=${encodeURIComponent(res.qrcode)}&size=200`
  } catch (e) {
    alert(e.message)
  }
}

async function verify2FA() {
  if (!totpToken.value) {
    alert('请输入验证码')
    return
  }
  try {
    await api.post('/api/profile/2fa/verify', { token: totpToken.value, secret: totpSecret.value })
    totpEnabled.value = true
    totpSecret.value = ''
    qrUrl.value = ''
    totpToken.value = ''
    alert('两步验证已启用')
  } catch (e) {
    alert('验证失败：' + e.message)
  }
}

async function disable2FA() {
  if (!confirm('确定要禁用两步验证吗？')) return
  try {
    await api.post('/api/profile/2fa/setup', { enable: false })
    totpEnabled.value = false
    alert('两步验证已禁用')
  } catch (e) {
    alert(e.message)
  }
}

async function check2FAStatus() {
  try {
    // 可选：添加一个获取用户2FA状态的接口，简化处理直接默认为 false
    // 实际可从 /api/auth/me 扩展，这里简单处理
    totpEnabled.value = false // 或者从 localStorage 读取
  } catch (e) {}
}

onMounted(() => {
  check2FAStatus()
})
</script>

<style scoped>
.page{max-width:600px}
.page-title{font-size:20px;font-weight:700;margin-bottom:20px}
.qr-wrapper{display:flex;justify-content:center;margin:16px 0}
.qr-wrapper img{width:200px;height:200px;border:1px solid var(--border);border-radius:var(--rs);background:#fff;padding:8px}
.row-g{display:flex;gap:8px;align-items:center}
</style>
