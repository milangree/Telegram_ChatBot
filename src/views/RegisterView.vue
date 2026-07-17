<template>
  <div class="auth-page">
    <div class="auth-card card">
      <div class="login-logo">
        <AppIcon name="logo" :size="44" />
      </div>
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
import AppIcon from '../components/AppIcon.vue'
import { useAuthStore } from '../stores/auth.js'
import { useI18nStore } from '../stores/i18n'
import { readJsonSafe } from '../utils/http.js'

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
    const data = await readJsonSafe(res, {})
    if (!res.ok) throw new Error(data.error || t('auth.register.err.fallback'))
    if (!data.token) throw new Error(t('auth.register.err.fallback'))
    auth.token = data.token; auth.username = data.username; auth.isAdmin = true
    localStorage.setItem('token', data.token); localStorage.setItem('username', data.username); localStorage.setItem('isAdmin', 'true')
    router.push('/')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>

<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px;position:relative;overflow:hidden}
.auth-page::before{
  content:'';position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(79,142,247,.12), transparent),
    radial-gradient(ellipse 50% 40% at 20% 80%, rgba(99,102,241,.08), transparent),
    radial-gradient(ellipse 40% 30% at 85% 70%, rgba(79,142,247,.06), transparent);
}
:root.light .auth-page::before{
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(37,99,235,.08), transparent),
    radial-gradient(ellipse 50% 40% at 20% 80%, rgba(99,102,241,.06), transparent),
    radial-gradient(ellipse 40% 30% at 85% 70%, rgba(14,165,233,.04), transparent);
}
.auth-card{width:100%;max-width:380px;padding:36px 28px;position:relative;animation:loginIn .4s var(--ease-out)}
@keyframes loginIn{
  from{opacity:0;transform:translateY(20px) scale(.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
.login-logo{display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.login-title{font-size:20px;font-weight:700;text-align:center;margin-bottom:20px}
</style>
