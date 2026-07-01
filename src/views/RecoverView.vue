<template>
  <div style="width:420px;max-width:calc(100vw - 32px);padding:16px;margin:0 auto">
    <v-card elevation="8" rounded="xl" class="overflow-hidden" style="width:100%">
      <div style="height:4px;background:linear-gradient(90deg, var(--v-theme-primary), var(--v-theme-secondary))" />
      <div class="pa-7 pb-6">
        <div class="text-center mb-5">
          <v-avatar size="64" color="primary" rounded="xl" class="mb-3">
            <v-icon :icon="mdiLock" size="36" />
          </v-avatar>
          <h1 class="text-h5 font-weight-bold">{{ t('auth.recover.title') }}</h1>
        </div>

        <v-alert type="info" variant="tonal" density="compact" class="mb-4">{{ t('auth.recover.tip') }}</v-alert>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>
        <v-alert v-if="success" type="success" variant="tonal" density="compact" class="mb-4">{{ t('auth.recover.success') }}</v-alert>

        <v-text-field v-model="username" :label="t('auth.recover.username')" :prepend-inner-icon="mdiAccount" density="comfortable" />
        <v-text-field v-model="totp" :label="t('auth.recover.totp')" :placeholder="t('auth.recover.totpPh')" maxlength="6" inputmode="numeric" :prepend-inner-icon="mdiKeyVariant" density="comfortable" />
        <v-text-field v-model="newPassword" :label="t('auth.recover.newPassword')" :placeholder="t('auth.recover.newPasswordPh')" type="password" :prepend-inner-icon="mdiLock" density="comfortable" @keydown.enter="doRecover" />

        <v-btn block color="primary" size="large" rounded="lg" :loading="loading" :disabled="success" class="mt-2" @click="doRecover">
          {{ t('auth.recover.submit') }}
        </v-btn>

        <div class="text-center mt-5">
          <RouterLink to="/login" class="text-body-2 text-primary text-decoration-none">← {{ t('auth.recover.backLogin') }}</RouterLink>
        </div>
      </div>
    </v-card>
  </div>
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
