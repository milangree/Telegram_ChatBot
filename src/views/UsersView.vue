<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">👥 用户管理</h2>
      <div class="flex gap-2">
        <select v-model="filter" style="width:110px">
          <option value="">全部</option>
          <option value="blocked">已封禁</option>
          <option value="normal">正常</option>
        </select>
        <button class="btn-ghost btn-sm" @click="load">🔄</button>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="card mb-2">
      <h3 class="sec-title">⚡ 快速操作</h3>
      <div class="quick-row">
        <UserSearchPicker v-model="quickId" placeholder="搜索用户…" @selected="u => quickId = String(u.user_id)" style="flex:1" />
        <input v-model="quickReason" placeholder="原因（可留空）" style="flex:1" />
        <button class="btn-danger btn-sm" :disabled="!quickId" @click="quickBlock">🚫 封禁</button>
        <button class="btn-success btn-sm" :disabled="!quickId" @click="quickUnblock">✅ 解封</button>
        <button class="btn-ghost btn-sm"   :disabled="!quickId" @click="quickWhitelist">⚪ 白名单</button>
      </div>
      <div v-if="quickMsg" class="alert mt-1" :class="quickOk ? 'alert-success' : 'alert-error'">{{ quickMsg }}</div>
    </div>

    <div class="card">
      <div v-if="loading" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
      <template v-else>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr>
                <th>用户</th>
                <th class="hide-mobile">Telegram ID</th>
                <th>状态</th>
                <th class="hide-mobile">用户名</th>
                <th class="hide-mobile">注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in displayUsers" :key="u.user_id">
                <td>
                  <div class="user-cell">
                    <div class="u-ava" :class="{blocked:u.is_blocked}" @click="showAvatar(u)">
                      <img v-if="avatars[u.user_id]" :src="avatars[u.user_id]" class="ava-img" @error="avatars[u.user_id] = ''" />
                      <span v-else>{{ (u.first_name||u.username||'?')[0].toUpperCase() }}</span>
                    </div>
                    <div>
                      <div style="font-weight:500;font-size:13px">{{ u.first_name }} {{ u.last_name }}</div>
                      <div class="text-muted text-sm hide-mobile">{{ u.username ? '@'+u.username : '—' }}</div>
                    </div>
                  </div>
                </td>
                <td class="hide-mobile"><code style="font-size:12px">{{ u.user_id }}</code></td>
                <td><span class="badge" :class="u.is_blocked?'badge-danger':'badge-success'">{{ u.is_blocked?(u.is_permanent_block?'永久封禁':'封禁'):'正常' }}</span></td>
                <td class="hide-mobile">
                  <div v-if="editingUsername === u.user_id" class="row-g">
                    <input v-model="newUsername" style="width:120px;padding:4px 8px;font-size:12px" @keydown.enter="saveUsername(u)" @keydown.esc="editingUsername=null" />
                    <button class="btn-primary btn-sm" @click="saveUsername(u)">✓</button>
                    <button class="btn-ghost btn-sm" @click="editingUsername=null">✕</button>
                  </div>
                  <div v-else class="flex gap-2 align-items-center">
                    <span class="text-sm text-muted">{{ u.username || '—' }}</span>
                    <button class="btn-icon" style="font-size:11px;padding:2px 4px" title="修改用户名" @click="startEditUsername(u)">✏️</button>
                  </div>
                </td>
                <td class="hide-mobile text-muted text-sm">{{ fmtDate(u.created_at) }}</td>
                <td>
                  <div class="flex gap-1 flex-wrap">
                    <button v-if="!u.is_blocked" class="btn-danger btn-sm" @click="blockOne(u)">封</button>
                    <button v-else class="btn-success btn-sm" @click="unblockOne(u)">解封</button>
                    <RouterLink :to="`/conversations?user=${u.user_id}`" class="btn-ghost btn-sm" style="text-decoration:none">消息</RouterLink>
                  </div>
                </td>
              </tr>
              <tr v-if="!displayUsers.length">
                <td colspan="6" class="text-center text-muted" style="padding:24px">暂无用户</td>
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
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'

const users = ref([]), total = ref(0), page = ref(1), pageSize = 20
const loading = ref(true), filter = ref('')
const quickId = ref(''), quickReason = ref(''), quickMsg = ref(''), quickOk = ref(true)
const editingUsername = ref(null), newUsername = ref('')
const avatars = ref({})

const displayUsers = computed(() => {
  if (filter.value === 'blocked') return users.value.filter(u => u.is_blocked)
  if (filter.value === 'normal')  return users.value.filter(u => !u.is_blocked)
  return users.value
})

async function load() {
  loading.value = true
  try {
    const d = await api.get(`/api/users?page=${page.value}`)
    users.value = d.users; total.value = d.total
    // Preload avatars for visible users
    for (const u of d.users) loadAvatar(u)
  } finally { loading.value = false }
}

function loadAvatar(u) {
  const img = new Image()
  img.onload = () => { avatars.value[u.user_id] = `/api/users/${u.user_id}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${u.user_id}/avatar`
}

function showAvatar(u) { /* Could show modal */ }

function startEditUsername(u) { editingUsername.value = u.user_id; newUsername.value = u.username || '' }
async function saveUsername(u) {
  try {
    await api.put(`/api/users/${u.user_id}/username`, { username: newUsername.value })
    u.username = newUsername.value; editingUsername.value = null
  } catch (e) { alert(e.message) }
}

function flash(msg, ok = true) { quickMsg.value = msg; quickOk.value = ok; setTimeout(() => quickMsg.value = '', 4000) }

async function quickBlock()     { try { await api.put(`/api/users/${quickId.value}/block`, { reason: quickReason.value||'快速封禁', permanent: true }); flash(`✅ 已封禁 ${quickId.value}`); await load() } catch (e) { flash('❌ ' + e.message, false) } }
async function quickUnblock()   { try { await api.put(`/api/users/${quickId.value}/unblock`, {}); flash(`✅ 已解封 ${quickId.value}`); await load() } catch (e) { flash('❌ ' + e.message, false) } }
async function quickWhitelist() { try { await api.post(`/api/whitelist/${quickId.value}`, { reason: '快速添加' }); flash(`✅ 已加入白名单`); } catch (e) { flash('❌ ' + e.message, false) } }

async function blockOne(u) {
  const r = prompt('封禁原因（可留空）：') ?? ''; if (r === null) return
  await api.put(`/api/users/${u.user_id}/block`, { reason: r, permanent: true })
  u.is_blocked = 1; u.is_permanent_block = 1; u.block_reason = r
}
async function unblockOne(u) {
  await api.put(`/api/users/${u.user_id}/unblock`, {})
  u.is_blocked = 0; u.is_permanent_block = 0
}

function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : '—' }

watch(filter, () => { page.value = 1; load() })
onMounted(load)
</script>

<style scoped>
.quick-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.user-cell{display:flex;align-items:center;gap:10px}
.u-ava{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;cursor:pointer;overflow:hidden}
.u-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.ava-img{width:100%;height:100%;object-fit:cover}
</style>
