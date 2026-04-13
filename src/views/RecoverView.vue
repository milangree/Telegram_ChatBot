<template>
  <div class="auth-page">
    <div class="auth-card card">
      <h1 class="login-title">🔑 {{ t('auth.recover.title') }}</h1>
      <div class="alert alert-info mb-2">{{ t('auth.recover.tip') }}</div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div v-if="success" class="alert alert-success">✅ {{ t('auth.recover.success') }}</div>

      <div class="form-group">
        <label>{{ t('auth.recover.username') }}</label>
        <input v-model="username" :placeholder="t('auth.recover.username')" />
      </div>
      <div class="form-group">
        <label>{{ t('auth.recover.totp') }}</label>
        <input v-model="totp" :placeholder="t('auth.recover.totpPh')" maxlength="6" />
      </div>
      <div class="form-group">
        <label>{{ t('auth.recover.newPassword') }}</label>
        <input v-model="newPassword" type="password" :placeholder="t('auth.recover.newPasswordPh')" />
      </div>
      <button class="btn-primary w-full" @click="doRecover" :disabled="loading">
        <span v-if="loading" class="spinner"></span>{{ loading ? t('auth.recover.submitting') : t('auth.recover.submit') }}
      </button>
      <div style="margin-top:12px;text-align:center">
        <RouterLink to="/login" class="text-sm">← {{ t('auth.recover.backLogin') }}</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'

const router      = useRouter()
const i18n        = useI18nStore()
const t           = i18n.t
const username    = ref(''), totp = ref(''), newPassword = ref('')
const loading     = ref(false), error = ref(''), success = ref(false)

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

<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-card{width:100%;max-width:380px;padding:36px 28px}
.login-title{font-size:20px;font-weight:700;text-align:center;margin-bottom:20px}
</style>
