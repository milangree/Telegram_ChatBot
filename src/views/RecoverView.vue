<template>
  <v-container fluid class="d-flex align-center justify-center" style="min-height:100vh">
    <v-card width="400" class="pa-5" rounded="xl">
      <div class="text-center mb-4">
        <v-icon :icon="mdiLock" size="48" color="primary" class="mb-2" />
        <h1 class="text-h5 font-weight-bold">{{ t('auth.recover.title') }}</h1>
      </div>

      <v-alert type="info" variant="tonal" class="mb-4">{{ t('auth.recover.tip') }}</v-alert>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
      <v-alert v-if="success" type="success" variant="tonal" class="mb-4">{{ t('auth.recover.success') }}</v-alert>

      <v-text-field v-model="username" :label="t('auth.recover.username')" :prepend-inner-icon="mdiAccount" />
      <v-text-field v-model="totp" :label="t('auth.recover.totp')" :placeholder="t('auth.recover.totpPh')" maxlength="6" inputmode="numeric" :prepend-inner-icon="mdiKeyVariant" />
      <v-text-field v-model="newPassword" :label="t('auth.recover.newPassword')" :placeholder="t('auth.recover.newPasswordPh')" type="password" prepend-inner-:icon="mdiLock" @keydown.enter="doRecover" />

      <v-btn block color="primary" size="large" :loading="loading" :disabled="success" @click="doRecover">
        {{ t('auth.recover.submit') }}
      </v-btn>

      <div class="text-center mt-4">
        <RouterLink to="/login" class="text-primary text-caption">← {{ t('auth.recover.backLogin') }}</RouterLink>
      </div>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { mdiLock, mdiAccount, mdiKeyVariant } from '@mdi/js'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'

const router = useRouter()
const i18n = useI18nStore()
const t = i18n.t
const username = ref('')
const totp = ref('')
const newPassword = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)

async function doRecover() {
  if (!username.value || !totp.value || !newPassword.value) { error.value = t('auth.recover.err.required'); return }
  loading.value = true; error.value = ''
  try {
    await api.post('/api/auth/recover', { username: username.value, totp: totp.value, newPassword: newPassword.value })
    success.value = true
    setTimeout(() => router.push('/login'), 1500)
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>
