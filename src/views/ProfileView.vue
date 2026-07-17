<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title page-title-with-icon">
          <AppIcon name="profile" :size="20" />
          {{ t('profile.title') }}
        </h2>
        <div class="page-subtitle" v-if="auth.username">@{{ auth.username }}</div>
      </div>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title sec-title-with-icon">
        <AppIcon name="profile" :size="16" />
        {{ t('profile.username.title') }}
      </h3>
      <div class="form-group">
        <label>{{ t('profile.username.new') }}</label>
        <input v-model="newUsername" :placeholder="t('profile.username.ph')" autocomplete="username" />
      </div>
      <button class="btn-primary" @click="changeUsername" :disabled="unameLoading">
        <span v-if="unameLoading" class="spinner"></span>{{ t('profile.username.submit') }}
      </button>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title sec-title-with-icon">
        <AppIcon name="key" :size="16" />
        {{ t('profile.password.title') }}
      </h3>
      <div class="form-group">
        <label>{{ t('profile.password.current') }}</label>
        <input type="password" v-model="oldPw" autocomplete="current-password" />
      </div>
      <div class="form-group">
        <label>{{ t('profile.password.new') }}</label>
        <input type="password" v-model="newPw" :placeholder="t('profile.password.ph')" autocomplete="new-password" />
      </div>
      <button class="btn-primary" @click="changePassword" :disabled="pwLoading">
        <span v-if="pwLoading" class="spinner"></span>{{ t('profile.password.submit') }}
      </button>
    </div>

    <div class="card">
      <h3 class="sec-title sec-title-with-icon">
        <AppIcon name="lock" :size="16" />
        {{ t('profile.2fa.title') }}
      </h3>

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
          <p class="text-sm text-muted" style="margin-top:8px">{{ t('profile.2fa.manualOnly') }}</p>
        </div>
        <!-- 仅本地展示密钥，不请求第三方二维码服务，避免 TOTP 种子外泄 -->
        <div class="form-group">
          <label>{{ t('profile.2fa.verifyLabel') }}</label>
          <div class="row-g">
            <input v-model="totpToken" placeholder="123456" maxlength="6" inputmode="numeric" @keydown.enter="verify2FA" />
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
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import { useAuthStore } from '../stores/auth.js'
import { useI18nStore } from '../stores/i18n'
import { useDialog } from '../stores/dialog.js'
import { useToast } from '../stores/toast.js'

const auth = useAuthStore()
const i18n = useI18nStore()
const t = i18n.t
const dialog = useDialog()
const toast = useToast()

const newUsername = ref(''), unameLoading = ref(false)
const oldPw = ref(''), newPw = ref(''), pwLoading = ref(false)
const totpEnabled = ref(false), totpSecret = ref(''), totpToken = ref('')
const totpLoading = ref(false)

function flash(msg, ok = true) {
  if (ok) toast.success(msg)
  else toast.error(msg)
}

async function changeUsername() {
  if (!newUsername.value) return
  unameLoading.value = true
  try {
    await api.put('/api/profile/username', { newUsername: newUsername.value })
    flash(t('profile.flash.usernameUpdated'))
    auth.username = newUsername.value
    localStorage.setItem('username', newUsername.value)
    newUsername.value = ''
  } catch (e) {
    flash(e.message, false)
  } finally {
    unameLoading.value = false
  }
}

async function changePassword() {
  if (!oldPw.value || !newPw.value) return
  pwLoading.value = true
  try {
    const r = await api.put('/api/profile/password', { oldPassword: oldPw.value, newPassword: newPw.value })
    flash(t('profile.flash.passwordUpdated'))
    oldPw.value = ''
    newPw.value = ''
    // 服务端已吊销全部会话，需要重新登录
    if (r?.reLogin) {
      await auth.logout({ skipRequest: true })
      window.location.href = '/login'
    }
  } catch (e) {
    flash(e.message, false)
  } finally {
    pwLoading.value = false
  }
}

async function setup2FA() {
  totpLoading.value = true
  try {
    const d = await api.post('/api/profile/2fa/setup', { enable: true })
    totpSecret.value = d.secret
  } catch (e) {
    flash(e.message, false)
  } finally {
    totpLoading.value = false
  }
}

async function verify2FA() {
  if (!totpToken.value) return
  totpLoading.value = true
  try {
    await api.post('/api/profile/2fa/verify', { token: totpToken.value, secret: totpSecret.value })
    totpEnabled.value = true
    totpSecret.value = ''
    totpToken.value = ''
    flash(t('profile.flash.2faEnabled'))
  } catch (e) {
    flash(e.message, false)
  } finally {
    totpLoading.value = false
  }
}

async function disable2FA() {
  const ok = await dialog.confirm({
    title: t('profile.2fa.disable'),
    message: t('profile.2fa.disableConfirm'),
    danger: true,
    confirmText: t('profile.2fa.disable'),
  })
  if (!ok) return
  totpLoading.value = true
  try {
    await api.post('/api/profile/2fa/setup', { enable: false })
    totpEnabled.value = false
    flash(t('profile.flash.2faDisabled'))
  } catch (e) {
    flash(e.message, false)
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
