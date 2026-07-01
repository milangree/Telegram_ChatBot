<template>
  <v-container fluid class="d-flex align-center justify-center" style="min-height:100vh">
    <v-card width="400" class="pa-5" rounded="xl">
      <div class="text-center mb-4">
        <v-icon :icon="mdiRobotOutline" size="48" color="primary" class="mb-2" />
        <h1 class="text-h5 font-weight-bold">{{ t('auth.register.title') }}</h1>
      </div>

      <v-alert type="info" variant="tonal" class="mb-4">{{ t('auth.register.tip') }}</v-alert>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">{{ error }}</v-alert>

      <v-text-field v-model="username" :label="t('auth.register.username')" :placeholder="t('auth.register.usernamePh')" :prepend-inner-icon="mdiAccount" />
      <v-text-field v-model="password" :label="t('auth.register.password')" :placeholder="t('auth.register.passwordPh')" type="password" prepend-inner-:icon="mdiLock" @keydown.enter="doRegister" />

      <v-btn block color="primary" size="large" :loading="loading" @click="doRegister">
        {{ t('auth.register.submit') }}
      </v-btn>

      <div class="text-center mt-4">
        <RouterLink to="/login" class="text-primary text-caption">← {{ t('auth.register.toLogin') }}</RouterLink>
      </div>
    </v-card>
  </v-container>
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
