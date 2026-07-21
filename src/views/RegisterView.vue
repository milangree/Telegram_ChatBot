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
        <input v-model="password" type="password" :placeholder="t('auth.register.passwordPh')" autocomplete="new-password" @keydown.enter="doRegister" />
      </div>
      <button class="btn-primary w-full" @click="doRegister" :disabled="loading">
        <span v-if="loading" class="spinner"></span>{{ loading ? t('auth.register.submitting') : t('auth.register.submit') }}
      </button>
      <div class="auth-footer-link">
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
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: username.value, password: password.value }),
    })
    const data = await readJsonSafe(res, {})
    if (!res.ok) throw new Error(data.error || t('auth.register.err.fallback'))
    if (!data.username) throw new Error(t('auth.register.err.fallback'))
    // 主会话依赖 HttpOnly Cookie
    auth.token = ''
    auth.username = data.username
    auth.isAdmin = true
    auth.sessionReady = true
    localStorage.setItem('username', data.username)
    localStorage.setItem('isAdmin', 'true')
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
:global(:root.light) .auth-page::before{
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(37,99,235,.08), transparent),
    radial-gradient(ellipse 50% 40% at 20% 80%, rgba(99,102,241,.06), transparent),
    radial-gradient(ellipse 40% 30% at 85% 70%, rgba(14,165,233,.04), transparent);
}
:global(:root.glass) .auth-page{background:transparent}
:global(:root.glass) .auth-page::before{
  opacity:.9;
  background:
    radial-gradient(ellipse 90% 55% at 50% -5%, rgba(79,142,247,.22), transparent 55%),
    radial-gradient(ellipse 55% 45% at 15% 85%, rgba(99,102,241,.16), transparent 55%),
    radial-gradient(ellipse 45% 35% at 90% 70%, rgba(56,189,248,.12), transparent 55%);
}
:global(:root.light.glass) .auth-page::before{
  background:
    radial-gradient(ellipse 90% 55% at 50% -5%, rgba(37,99,235,.14), transparent 55%),
    radial-gradient(ellipse 55% 45% at 15% 85%, rgba(99,102,241,.1), transparent 55%),
    radial-gradient(ellipse 45% 35% at 90% 70%, rgba(14,165,233,.1), transparent 55%);
}
.auth-card{width:100%;max-width:380px;padding:28px 28px 32px;position:relative;animation:loginIn .4s var(--ease-out);z-index:1}
@keyframes loginIn{
  from{opacity:0;transform:translateY(20px) scale(.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
.login-logo{display:flex;align-items:center;justify-content:center;margin-bottom:12px;animation:logoFloat 4s var(--ease-in-out) infinite}
@keyframes logoFloat{
  0%,100%{transform:translateY(0)}
  50%{transform:translateY(-4px)}
}
.login-title{font-size:21px;font-weight:700;text-align:center;margin-bottom:18px}
.auth-footer-link{margin-top:16px;text-align:center}
@media (max-width:480px){
  .auth-page{padding:14px}
  .auth-card{padding:22px 18px 26px}
}
</style>
