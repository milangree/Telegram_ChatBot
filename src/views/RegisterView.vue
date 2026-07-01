<template>
  <div style="width:420px;max-width:calc(100vw - 32px);padding:16px;margin:0 auto">
    <v-card elevation="8" rounded="xl" class="overflow-hidden" style="width:100%">
      <div style="height:4px;background:linear-gradient(90deg, var(--v-theme-primary), var(--v-theme-secondary))" />
      <div class="pa-7 pb-6">
        <div class="text-center mb-5">
          <v-avatar size="64" color="primary" rounded="xl" class="mb-3">
            <v-icon :icon="mdiRobotOutline" size="36" />
          </v-avatar>
          <h1 class="text-h5 font-weight-bold">{{ t('auth.register.title') }}</h1>
        </div>

        <v-alert type="info" variant="tonal" density="compact" class="mb-4">{{ t('auth.register.tip') }}</v-alert>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>

        <v-text-field v-model="username" :label="t('auth.register.username')" :placeholder="t('auth.register.usernamePh')" :prepend-inner-icon="mdiAccount" density="comfortable" />
        <v-text-field v-model="password" :label="t('auth.register.password')" :placeholder="t('auth.register.passwordPh')" type="password" :prepend-inner-icon="mdiLock" density="comfortable" @keydown.enter="doRegister" />

        <v-btn block color="primary" size="large" rounded="lg" :loading="loading" class="mt-2" @click="doRegister">
          {{ t('auth.register.submit') }}
        </v-btn>

        <div class="text-center mt-5">
          <RouterLink to="/login" class="text-body-2 text-primary text-decoration-none">← {{ t('auth.register.toLogin') }}</RouterLink>
        </div>
      </div>
    </v-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { mdiRobotOutline, mdiAccount, mdiLock } from '@mdi/js'
import { useAuthStore } from '../stores/auth.js'
import { useI18nStore } from '../stores/i18n'

const auth = useAuthStore()
const i18n = useI18nStore()
const t = i18n.t
const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function doRegister() {
  if (!username.value || !password.value) { error.value = t('auth.register.err.required'); return }
  loading.value = true; error.value = ''
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('auth.register.err.fallback'))
    auth.token = data.token; auth.username = data.username; auth.isAdmin = true
    localStorage.setItem('token', data.token)
    localStorage.setItem('username', data.username)
    localStorage.setItem('isAdmin', 'true')
    router.push('/')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>
