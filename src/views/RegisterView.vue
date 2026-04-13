<template>
  <div class="auth-page">
    <div class="auth-card card">
      <div class="login-logo">🤖</div>
      <h1 class="login-title">{{ t('auth.register.title') }}</h1>
      <div class="alert alert-info mb-2">{{ t('auth.register.tip') }}</div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="form-group">
        <label>{{ t('auth.register.username') }}</label>
        <input v-model="username" :placeholder="t('auth.register.usernamePh')" autocomplete="username" />
      </div>
      <div class="form-group">
        <label>{{ t('auth.register.password') }}</label>
        <input v-model="password" type="password" :placeholder="t('auth.register.passwordPh')" autocomplete="new-password" />
      </div>
      <button class="btn-primary w-full" @click="doRegister" :disabled="loading">
        <span v-if="loading" class="spinner"></span>{{ loading ? t('auth.register.submitting') : t('auth.register.submit') }}
      </button>
      <div style="margin-top:12px;text-align:center">
        <RouterLink to="/login" class="text-sm">← {{ t('auth.register.toLogin') }}</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useI18nStore } from '../stores/i18n'

const auth     = useAuthStore()
const i18n     = useI18nStore()
const t        = i18n.t
const router   = useRouter()
const username = ref(''), password = ref(''), loading = ref(false), error = ref('')

async function doRegister() {
  if (!username.value || !password.value) { error.value = t('auth.register.err.required'); return }
  loading.value = true; error.value = ''
  try {
    const res  = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: username.value, password: password.value }) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('auth.register.err.fallback'))
    auth.token = data.token; auth.username = data.username; auth.isAdmin = true
    localStorage.setItem('token', data.token); localStorage.setItem('username', data.username); localStorage.setItem('isAdmin', 'true')
    router.push('/')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>

<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-card{width:100%;max-width:380px;padding:36px 28px}
.login-logo{font-size:44px;text-align:center;margin-bottom:12px}
.login-title{font-size:20px;font-weight:700;text-align:center;margin-bottom:20px}
</style>
