<template>
  <div class="auth-page">
    <div class="auth-card card">
      <div class="login-logo">
        <AppIcon
          name="lock"
          :size="40"
        />
      </div>
      <h1 class="login-title">
        {{ t('auth.recover.title') }}
      </h1>
      <p class="auth-tip">
        {{ t('auth.recover.tip') }}
      </p>
      <div
        v-if="error"
        class="alert alert-error"
      >
        {{ error }}
      </div>
      <div
        v-if="success"
        class="alert alert-success"
      >
        {{ t('auth.recover.success') }}
      </div>

      <div class="form-group">
        <label>{{ t('auth.recover.username') }}</label>
        <input
          v-model="username"
          :placeholder="t('auth.recover.username')"
          autocomplete="username"
        >
      </div>
      <div class="form-group">
        <label>{{ t('auth.recover.totp') }}</label>
        <input
          v-model="totp"
          :placeholder="t('auth.recover.totpPh')"
          maxlength="6"
          inputmode="numeric"
          autocomplete="one-time-code"
        >
      </div>
      <div class="form-group">
        <label>{{ t('auth.recover.newPassword') }}</label>
        <input
          v-model="newPassword"
          type="password"
          :placeholder="t('auth.recover.newPasswordPh')"
          autocomplete="new-password"
          @keydown.enter="doRecover"
        >
      </div>
      <button
        class="btn-primary w-full"
        :disabled="loading"
        @click="doRecover"
      >
        <span
          v-if="loading"
          class="spinner"
        />{{ loading ? t('auth.recover.submitting') : t('auth.recover.submit') }}
      </button>
      <div class="auth-footer-link">
        <RouterLink
          to="/login"
          class="text-sm"
        >
          ← {{ t('auth.recover.backLogin') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'

const router      = useRouter()
const i18n        = useI18nStore()
const t           = i18n.t
const username    = ref(''), totp = ref(''), newPassword = ref('')
const loading     = ref(false), error = ref(''), success = ref(false)

async function doRecover() {
  if (!username.value || !newPassword.value || !totp.value) {
    error.value = t('auth.recover.err.required')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await api.post('/api/auth/recover', {
      username: username.value,
      totp: totp.value,
      newPassword: newPassword.value,
    })
    success.value = true
    setTimeout(() => router.push('/login'), 1500)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
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
.auth-card{width:100%;max-width:380px;padding:28px 28px 32px;position:relative;animation:loginIn .4s var(--ease-out);z-index:1}
@keyframes loginIn{
  from{opacity:0;transform:translateY(20px) scale(.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
.login-logo{display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:var(--accent)}
.login-title{font-size:21px;font-weight:700;text-align:center;margin-bottom:10px}
.auth-tip{font-size:12px;color:var(--text3);text-align:center;margin:0 0 16px;line-height:1.5}
.auth-footer-link{margin-top:16px;text-align:center}
@media (max-width:480px){
  .auth-page{padding:14px}
  .auth-card{padding:22px 18px 26px}
}
</style>
