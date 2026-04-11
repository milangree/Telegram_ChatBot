<template>
  <div class="auth-page">
    <div class="auth-card card">
      <div class="auth-logo">🚀</div>
      <h1 class="auth-title">初始化设置</h1>
      <p class="auth-sub text-muted">首次运行，请创建管理员账号</p>
      <div class="alert alert-info">此账号为系统唯一管理员，注册后不可再注册新账号。</div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <form @submit.prevent="submit">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="form.username" type="text" placeholder="至少 3 个字符" minlength="3" required autocomplete="username" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="form.password" type="password" placeholder="至少 6 个字符" minlength="6" required autocomplete="new-password" />
        </div>
        <div class="form-group">
          <label>确认密码</label>
          <input v-model="form.confirm" type="password" placeholder="再次输入密码" required autocomplete="new-password" />
        </div>
        <button type="submit" class="btn-primary w-full" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          {{ loading ? '创建中…' : '创建管理员账号' }}
        </button>
      </form>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
const auth = useAuthStore(), router = useRouter()
const form = ref({ username:'', password:'', confirm:'' }), loading = ref(false), error = ref('')
onMounted(async () => {
  const s = await auth.checkStatus().catch(()=>({ needsRegistration:false }))
  if (!s.needsRegistration) router.push('/login')
})
async function submit() {
  error.value = ''
  if (form.value.password !== form.value.confirm) { error.value = '两次密码不一致'; return }
  loading.value = true
  try { await auth.register(form.value.username, form.value.password); router.push('/') }
  catch(e) { error.value = e.message }
  finally { loading.value = false }
}
</script>
<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-card{width:100%;max-width:400px;padding:36px 32px}
.auth-logo{font-size:40px;text-align:center;margin-bottom:12px}
.auth-title{font-size:20px;font-weight:700;text-align:center;margin-bottom:4px}
.auth-sub{font-size:13px;text-align:center;margin-bottom:20px}
button{margin-top:8px}
</style>