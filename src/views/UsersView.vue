<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">👥 用户管理</h2>
      <div class="flex gap-2">
        <select v-model="filter" style="width:120px">
          <option value="">全部用户</option>
          <option value="blocked">已封禁</option>
          <option value="normal">正常</option>
        </select>
        <button class="btn-ghost btn-sm" @click="load">🔄 刷新</button>
      </div>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title">⚡ 快速封禁 / 解封</h3>
      <div class="quick-row">
        <div class="form-group" style="flex:1;margin-bottom:0">
          <UserSearchPicker v-model="quickId" placeholder="搜索用户名 / ID…" @selected="onQuickSelect" />
        </div>
        <input v-model="quickReason" placeholder="封禁原因（可留空）" style="flex:1" />
        <button class="btn-danger btn-sm" :disabled="!quickId" @click="quickBlock">🚫 封禁</button>
        <button class="btn-success btn-sm" :disabled="!quickId" @click="quickUnblock">✅ 解封</button>
      </div>
      <div v-if="quickMsg" class="alert mt-1" :class="quickOk?'alert-success':'alert-error'">{{ quickMsg }}</div>
    </div>

    <div class="card">
      <div v-if="loading" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
      <template v-else>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr><th>用户</th><th>Telegram ID</th><th>状态</th><th>封禁原因</th><th>注册时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in displayUsers" :key="u.user_id">
                <td><div class="user-cell"><div class="u-ava" :class="{blocked:u.is_blocked}">{{ (u.first_name||u.username||'?')[0].toUpperCase() }}</div><div><div style="font-weight:500">{{ u.first_name }} {{ u.last_name }}</div><div class="text-muted text-sm">{{ u.username?'@'+u.username:'' }}</div></div></div></td>
                <td><code style="font-size:12px">{{ u.user_id }}</code></td>
                <td><span class="badge" :class="u.is_blocked?'badge-danger':'badge-success'">{{ u.is_blocked?(u.is_permanent_block?'永久封禁':'封禁'):'正常' }}</span></td>
                <td class="text-muted text-sm">{{ u.block_reason||'—' }}</td>
                <td class="text-muted text-sm">{{ fmtDate(u.created_at) }}</td>
                <td><div class="flex gap-2"><button v-if="!u.is_blocked" class="btn-danger btn-sm" @click="blockOne(u)">封禁</button><button v-else class="btn-success btn-sm" @click="unblockOne(u)">解封</button><RouterLink :to="`/conversations?user=${u.user_id}`" class="btn-ghost btn-sm" style="text-decoration:none">消息</RouterLink></div></td>
              </tr>
              <tr v-if="!displayUsers.length"><td colspan="6" class="text-center text-muted" style="padding:24px">暂无用户</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="total > pageSize">
          <button class="btn-ghost btn-sm" :disabled="page<=1" @click="page--;load()">◀ 上页</button>
          <span class="text-muted text-sm">第 {{ page }} 页 · 共 {{ total }} 人</span>
          <button class="btn-ghost btn-sm" :disabled="page*pageSize>=total" @click="page++;load()">下页 ▶</button>
        </div>
      </template>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'

const users = ref([]), total = ref(0), page = ref(1), pageSize = 20
const loading = ref(true), filter = ref('')
const quickId = ref(''), quickReason = ref(''), quickMsg = ref(''), quickOk = ref(true)

const displayUsers = computed(() => {
  if (filter.value === 'blocked') return users.value.filter(u=>u.is_blocked)
  if (filter.value === 'normal')  return users.value.filter(u=>!u.is_blocked)
  return users.value
})

async function load() {
  loading.value = true
  try {
    const d = await api.get(`/api/users?page=${page.value}`)
    users.value = d.users; total.value = d.total
  } finally { loading.value = false }
}
function onQuickSelect(u) { quickId.value = String(u.user_id) }

async function quickBlock() {
  try {
    await api.put(`/api/users/${quickId.value}/block`, { reason: quickReason.value||'快速封禁', permanent:true })
    quickMsg.value = `✅ 已封禁用户 ${quickId.value}`; quickOk.value = true
    await load()
  } catch(e) { quickMsg.value = '❌ ' + e.message; quickOk.value = false }
  setTimeout(()=>quickMsg.value='', 4000)
}
async function quickUnblock() {
  try {
    await api.put(`/api/users/${quickId.value}/unblock`, {})
    quickMsg.value = `✅ 已解封用户 ${quickId.value}`; quickOk.value = true
    await load()
  } catch(e) { quickMsg.value = '❌ ' + e.message; quickOk.value = false }
  setTimeout(()=>quickMsg.value='', 4000)
}
async function blockOne(u) {
  const r = prompt('封禁原因（可留空）：') ?? ''
  await api.put(`/api/users/${u.user_id}/block`, { reason:r, permanent:true })
  u.is_blocked = true; u.is_permanent_block = true; u.block_reason = r
}
async function unblockOne(u) {
  await api.put(`/api/users/${u.user_id}/unblock`, {})
  u.is_blocked = false; u.is_permanent_block = false
}
function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : '—' }

watch(filter, ()=>{ page.value=1; load() })
onMounted(load)
</script>
<style scoped>
.page{max-width:1000px}
.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.page-title{font-size:20px;font-weight:700}
.sec-title{font-size:14px;font-weight:600;margin-bottom:12px}
.quick-row{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}
.user-cell{display:flex;align-items:center;gap:10px}
.u-ava{width:32px;height:32px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.u-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.pagination{display:flex;align-items:center;justify-content:center;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}
</style>