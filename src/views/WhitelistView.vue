<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">⚪ 白名单</h2>
      <button class="btn-ghost btn-sm" @click="load">🔄 刷新</button>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title">➕ 添加用户</h3>
      <div class="quick-row">
        <UserSearchPicker v-model="addId" placeholder="搜索用户名 / ID…" @selected="u => addId = String(u.user_id)" style="flex:1" />
        <input v-model="addReason" placeholder="原因（可留空）" style="flex:1" />
        <button class="btn-primary btn-sm" :disabled="!addId || adding" @click="doAdd">
          <span v-if="adding" class="spinner"></span>添加
        </button>
      </div>
      <div v-if="addMsg" class="alert mt-1" :class="addOk ? 'alert-success' : 'alert-error'">{{ addMsg }}</div>
      <div class="form-hint mt-1">白名单用户跳过人机验证和消息频率限制。需在设置中启用白名单功能。</div>
    </div>

    <div class="card">
      <div v-if="loading" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
      <template v-else>
        <div v-if="!users.length" class="text-center text-muted" style="padding:32px">白名单为空</div>
        <div style="overflow-x:auto" v-else>
          <table class="table">
            <thead>
              <tr>
                <th>用户</th>
                <th class="hide-mobile">Telegram ID</th>
                <th>原因</th>
                <th class="hide-mobile">添加时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.user_id">
                <td>
                  <div class="user-cell">
                    <div class="u-ava">{{ (u.first_name||u.username||'?')[0].toUpperCase() }}</div>
                    <div>
                      <div style="font-weight:500;font-size:13px">{{ u.first_name }} {{ u.last_name }}</div>
                      <div class="text-muted text-sm">{{ u.username ? '@'+u.username : '' }}</div>
                    </div>
                  </div>
                </td>
                <td class="hide-mobile"><code style="font-size:12px">{{ u.user_id }}</code></td>
                <td class="text-muted text-sm">{{ u.reason || '—' }}</td>
                <td class="hide-mobile text-muted text-sm">{{ fmtDate(u.created_at) }}</td>
                <td>
                  <button class="btn-danger btn-sm" @click="doRemove(u)">移出</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="total > pageSize">
          <button class="btn-ghost btn-sm" :disabled="page<=1" @click="page--;load()">◀</button>
          <span class="text-muted text-sm">第 {{ page }} 页 · 共 {{ total }} 人</span>
          <button class="btn-ghost btn-sm" :disabled="page*pageSize>=total" @click="page++;load()">▶</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'

const users = ref([]), total = ref(0), page = ref(1), pageSize = 20
const loading = ref(true)
const addId = ref(''), addReason = ref(''), addMsg = ref(''), addOk = ref(true), adding = ref(false)

async function load() {
  loading.value = true
  try {
    const d = await api.get(`/api/whitelist?page=${page.value}`)
    users.value = d.users; total.value = d.total
  } finally { loading.value = false }
}

async function doAdd() {
  if (!addId.value) return
  adding.value = true; addMsg.value = ''
  try {
    await api.post(`/api/whitelist/${addId.value}`, { reason: addReason.value })
    addMsg.value = `✅ 用户 ${addId.value} 已加入白名单`; addOk.value = true
    addId.value = ''; addReason.value = ''
    await load()
  } catch (e) { addMsg.value = '❌ ' + e.message; addOk.value = false }
  finally { adding.value = false; setTimeout(() => addMsg.value = '', 4000) }
}

async function doRemove(u) {
  if (!confirm(`确认将用户 ${u.user_id} 移出白名单？`)) return
  try {
    await api.delete(`/api/whitelist/${u.user_id}`)
    users.value = users.value.filter(x => x.user_id !== u.user_id)
    total.value--
  } catch (e) { alert(e.message) }
}

function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : '—' }
onMounted(load)
</script>

<style scoped>
.quick-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.user-cell{display:flex;align-items:center;gap:10px}
.u-ava{width:32px;height:32px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
</style>
