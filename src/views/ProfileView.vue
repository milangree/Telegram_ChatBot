<template>
  <v-container class="py-6" style="max-width:560px">
    <h2 class="text-h5 font-weight-bold d-flex align-center ga-2 mb-5">
      <v-icon :icon="mdiAccountCircleOutline" size="28" />
      {{ t('profile.title') }}
    </h2>

    <!-- 修改用户名 -->
    <v-card class="mb-4 pa-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-3">{{ t('profile.username.title') }}</h3>
      <v-text-field v-model="newUsername" :label="t('profile.username.new')" :placeholder="t('profile.username.ph')" :prepend-inner-icon="mdiAccount" />
      <v-alert v-if="unameMsg" :type="unameOk ? 'success' : 'error'" variant="tonal" class="mb-3" closable @click:close="unameMsg = ''">{{ unameMsg }}</v-alert>
      <v-btn color="primary" :loading="unameLoading" @click="changeUsername">{{ t('profile.username.submit') }}</v-btn>
    </v-card>

    <!-- 修改密码 -->
    <v-card class="mb-4 pa-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-3">{{ t('profile.password.title') }}</h3>
      <v-text-field v-model="oldPw" :label="t('profile.password.current')" type="password" prepend-inner-:icon="mdiLock" />
      <v-text-field v-model="newPw" :label="t('profile.password.new')" :placeholder="t('profile.password.ph')" type="password" prepend-inner-:icon="mdiLock" @keydown.enter="changePassword" />
      <v-alert v-if="pwMsg" :type="pwOk ? 'success' : 'error'" variant="tonal" class="mb-3" closable @click:close="pwMsg = ''">{{ pwMsg }}</v-alert>
      <v-btn color="primary" :loading="pwLoading" @click="changePassword">{{ t('profile.password.submit') }}</v-btn>
    </v-card>

    <!-- 2FA -->
    <v-card class="pa-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-3">{{ t('profile.2fa.title') }}</h3>

      <!-- 未启用 -->
      <template v-if="!totpEnabled && !totpSecret">
        <p class="text-body-2 text-medium-emphasis mb-3">{{ t('profile.2fa.tip') }}</p>
        <v-btn color="primary" :loading="totpLoading" @click="setup2FA">{{ t('profile.2fa.enable') }}</v-btn>
      </template>

      <!-- 设置中 -->
      <template v-if="totpSecret">
        <v-alert type="info" variant="tonal" class="mb-3">
          <p>{{ t('profile.2fa.step1') }}</p>
          <p>{{ t('profile.2fa.step2') }} <code class="user-select-all">{{ totpSecret }}</code></p>
        </v-alert>
        <div class="d-flex justify-center mb-4">
          <v-img
            :src="`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`"
            width="160" height="160" rounded="lg"
            style="border:3px solid var(--v-theme-surface-variant)"
          />
        </div>
        <v-text-field v-model="totpToken" :label="t('profile.2fa.verifyLabel')" placeholder="123456" maxlength="6" inputmode="numeric" :prepend-inner-icon="mdiKeyVariant" @keydown.enter="verify2FA">
          <template #append>
            <v-btn color="primary" :loading="totpLoading" @click="verify2FA">{{ t('profile.2fa.verifySubmit') }}</v-btn>
          </template>
        </v-text-field>
      </template>

      <!-- 已启用 -->
      <template v-if="totpEnabled && !totpSecret">
        <v-chip color="success" variant="tonal" class="mb-3">{{ t('profile.2fa.enabled') }}</v-chip>
        <br />
        <v-btn color="error" variant="tonal" :loading="totpLoading" @click="disable2FA">{{ t('profile.2fa.disable') }}</v-btn>
      </template>

      <v-alert v-if="totpMsg" :type="totpOk ? 'success' : 'error'" variant="tonal" class="mt-3" closable @click:close="totpMsg = ''">{{ totpMsg }}</v-alert>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { mdiAccountCircleOutline, mdiAccount, mdiLock, mdiKeyVariant } from '@mdi/js'
import api from '../stores/api.js'
import { useAuthStore } from '../stores/auth.js'
import { useI18nStore } from '../stores/i18n'

const auth = useAuthStore()
const i18n = useI18nStore()
const t = i18n.t

const newUsername = ref('')
const unameMsg = ref('')
const unameOk = ref(true)
const unameLoading = ref(false)
const oldPw = ref('')
const newPw = ref('')
const pwMsg = ref('')
const pwOk = ref(true)
const pwLoading = ref(false)
const totpEnabled = ref(false)
const totpSecret = ref('')
const qrUrl = ref('')
const totpToken = ref('')
const totpMsg = ref('')
const totpOk = ref(true)
const totpLoading = ref(false)

async function changeUsername() {
  if (!newUsername.value) return
  unameLoading.value = true; unameMsg.value = ''
  try {
    await api.put('/api/profile/username', { newUsername: newUsername.value })
    unameMsg.value = t('profile.flash.usernameUpdated'); unameOk.value = true
    auth.username = newUsername.value
    localStorage.setItem('username', newUsername.value)
    newUsername.value = ''
  } catch (e) { unameMsg.value = e.message; unameOk.value = false }
  finally { unameLoading.value = false; setTimeout(() => unameMsg.value = '', 4000) }
}

async function changePassword() {
  if (!oldPw.value || !newPw.value) return
  pwLoading.value = true; pwMsg.value = ''
  try {
    await api.put('/api/profile/password', { oldPassword: oldPw.value, newPassword: newPw.value })
    pwMsg.value = t('profile.flash.passwordUpdated'); pwOk.value = true
    oldPw.value = ''; newPw.value = ''
  } catch (e) { pwMsg.value = e.message; pwOk.value = false }
  finally { pwLoading.value = false; setTimeout(() => pwMsg.value = '', 4000) }
}

async function setup2FA() {
  totpLoading.value = true; totpMsg.value = ''
  try {
    const d = await api.post('/api/profile/2fa/setup', { enable: true })
    totpSecret.value = d.secret; qrUrl.value = d.qrcode
  } catch (e) { totpMsg.value = e.message; totpOk.value = false }
  finally { totpLoading.value = false }
}

async function verify2FA() {
  if (!totpToken.value) return
  totpLoading.value = true; totpMsg.value = ''
  try {
    await api.post('/api/profile/2fa/verify', { token: totpToken.value, secret: totpSecret.value })
    totpEnabled.value = true; totpSecret.value = ''; totpToken.value = ''
    totpMsg.value = t('profile.flash.2faEnabled'); totpOk.value = true
  } catch (e) { totpMsg.value = e.message; totpOk.value = false }
  finally { totpLoading.value = false; setTimeout(() => totpMsg.value = '', 4000) }
}

async function disable2FA() {
  if (!confirm(t('profile.2fa.disableConfirm'))) return
  totpLoading.value = true; totpMsg.value = ''
  try {
    await api.post('/api/profile/2fa/setup', { enable: false })
    totpEnabled.value = false
    totpMsg.value = t('profile.flash.2faDisabled'); totpOk.value = true
  } catch (e) { totpMsg.value = e.message; totpOk.value = false }
  finally { totpLoading.value = false; setTimeout(() => totpMsg.value = '', 4000) }
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
