<template>
  <div class="page">
    <h2 class="page-title mb-2">👤 {{ t('profile.title') }}</h2>

    <div class="card mb-2">
      <h3 class="sec-title">{{ t('profile.username.title') }}</h3>
      <div class="form-group">
        <label>{{ t('profile.username.new') }}</label>
        <input v-model="newUsername" :placeholder="t('profile.username.ph')" />
      </div>
      <div v-if="unameMsg" class="alert" :class="unameOk ? 'alert-success' : 'alert-error'">{{ unameMsg }}</div>
      <button class="btn-primary" @click="changeUsername" :disabled="unameLoading">
        <span v-if="unameLoading" class="spinner"></span>{{ t('profile.username.submit') }}
      </button>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title">{{ t('profile.password.title') }}</h3>
      <div class="form-group">
        <label>{{ t('profile.password.current') }}</label>
        <input type="password" v-model="oldPw" />
      </div>
      <div class="form-group">
        <label>{{ t('profile.password.new') }}</label>
        <input type="password" v-model="newPw" :placeholder="t('profile.password.ph')" />
      </div>
      <div v-if="pwMsg" class="alert" :class="pwOk ? 'alert-success' : 'alert-error'">{{ pwMsg }}</div>
      <button class="btn-primary" @click="changePassword" :disabled="pwLoading">
        <span v-if="pwLoading" class="spinner"></span>{{ t('profile.password.submit') }}
      </button>
    </div>

    <div class="card">
      <h3 class="sec-title">{{ t('profile.2fa.title') }}</h3>

      <div v-if="!totpEnabled && !totpSecret">
        <p class="text-muted text-sm mb-2">{{ t('profile.2fa.tip') }}</p>
        <button class="btn-primary" @click="setup2FA" :disabled="totpLoading">
          <span v-if="totpLoading" class="spinner"></span>{{ t('profile.2fa.enable') }}
        </button>
      </div>

      <div v-if="totpSecret" class="mt-1">
        <div class="alert alert-info">
          <p>{{ t('profile.2fa.step1') }}</p>
          <p>{{ t('profile.2fa.step2') }} <code style="user-select:all">{{ totpSecret }}</code></p>
        </div>
        <div class="qr-wrap mb-2">
          <img :src="`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`" alt="QR Code" />
        </div>
        <div class="form-group">
          <label>{{ t('profile.2fa.verifyLabel') }}</label>
          <div class="row-g">
            <input v-model="totpToken" placeholder="123456" maxlength="6" @keydown.enter="verify2FA" />
            <button class="btn-primary" @click="verify2FA" :disabled="totpLoading">
              <span v-if="totpLoading" class="spinner"></span>{{ t('profile.2fa.verifySubmit') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="totpEnabled && !totpSecret">
        <p class="badge badge-success mb-2">{{ t('profile.2fa.enabled') }}</p>
        <button class="btn-danger" @click="disable2FA" :disabled="totpLoading">
          <span v-if="totpLoading" class="spinner"></span>{{ t('profile.2fa.disable') }}
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
import { useI18nStore } from '../stores/i18n'

const auth = useAuthStore()
const i18n = useI18nStore()
const t = i18n.t

const newUsername = ref(''), unameMsg = ref(''), unameOk = ref(true), unameLoading = ref(false)
const oldPw = ref(''), newPw = ref(''), pwMsg = ref(''), pwOk = ref(true), pwLoading = ref(false)
const totpEnabled = ref(false), totpSecret = ref(''), qrUrl = ref(''), totpToken = ref('')
const totpMsg = ref(''), totpOk = ref(true), totpLoading = ref(false)

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
    flash(unameMsg, unameOk, t('profile.flash.usernameUpdated'))
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
    flash(pwMsg, pwOk, t('profile.flash.passwordUpdated'))
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
    flash(totpMsg, totpOk, t('profile.flash.2faEnabled'))
  } catch (e) {
    flash(totpMsg, totpOk, '❌ ' + e.message, false)
  } finally {
    totpLoading.value = false
  }
}

async function disable2FA() {
  if (!confirm(t('profile.2fa.disableConfirm'))) return
  totpLoading.value = true
  totpMsg.value = ''
  try {
    await api.post('/api/profile/2fa/setup', { enable: false })
    totpEnabled.value = false
    flash(totpMsg, totpOk, t('profile.flash.2faDisabled'))
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
  } catch {}
})
</script>

<style scoped>
.page { max-width: 540px; margin: 0 auto; }
.qr-wrap { display: flex; justify-content: center; }
.qr-wrap img { border-radius: 8px; border: 4px solid var(--bg2); }
</style>
