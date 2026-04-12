<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">👥 用户管理</h2>
      <div class="flex gap-2 flex-wrap">
        <select v-model="filter" style="width:110px">
          <option value="">全部</option>
          <option value="blocked">已封禁</option>
          <option value="normal">正常</option>
        </select>
        <button class="btn-ghost btn-sm" @click="load">🔄</button>
      </div>
    </div>

    <!-- Quick single-user actions -->
    <div class="card mb-2">
      <h3 class="sec-title">⚡ 快速操作</h3>
      <div class="quick-row">
        <UserSearchPicker v-model="quickId" placeholder="搜索用户…" @selected="u => quickId = String(u.user_id)" style="flex:1" />
        <input v-model="quickReason" placeholder="原因（可留空）" style="flex:1" />
        <button class="btn-danger btn-sm" :disabled="!quickId" @click="quickBlock">🚫 封禁</button>
        <button class="btn-success btn-sm" :disabled="!quickId" @click="quickUnblock">✅ 解封</button>
        <button class="btn-ghost btn-sm" :disabled="!quickId" @click="quickWhitelist">⚪ 白名单</button>
      </div>
      <div v-if="quickMsg" class="alert mt-1" :class="quickOk ? 'alert-success' : 'alert-error'">{{ quickMsg }}</div>
    </div>

    <!-- Batch actions bar -->
    <div v-if="selected.length" class="batch-bar mb-2">
      <span class="text-sm text-muted">已选 {{ selected.length }} 人</span>
      <div class="flex gap-2 flex-wrap">
        <button class="btn-danger btn-sm" @click="batchBlock">🚫 批量封禁</button>
        <button class="btn-success btn-sm" @click="batchUnblock">✅ 批量解封</button>
        <button class="btn-ghost btn-sm" @click="batchWhitelist">⚪ 加白名单</button>
        <button class="btn-ghost btn-sm" @click="selected = []">✕ 取消</button>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
      <template v-else>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr>
                <th style="width:36px"><input type="checkbox" :checked="allSelected" @change="toggleAll" class="cb" /></th>
                <th>用户</th>
                <th class="hide-mobile">ID</th>
                <th>状态</th>
                <th class="hide-mobile">用户名</th>
                <th class="hide-mobile">首次联系 (UTC+8)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in displayUsers" :key="u.user_id" :class="{ 'row-sel': selected.includes(u.user_id) }">
                <td><input type="checkbox" :checked="selected.includes(u.user_id)" @change="toggleSelect(u.user_id)" class="cb" /></td>
                <td>
                  <div class="user-cell" @click="openDetail(u)" style="cursor:pointer">
                    <div class="u-ava" :class="{ blocked: u.is_blocked }">
                      <img v-if="avatars[u.user_id]" :src="avatars[u.user_id]" class="ava-img" @error="avatars[u.user_id] = ''" />
                      <span v-else>{{ (u.first_name || u.username || '?')[0].toUpperCase() }}</span>
                    </div>
                    <div>
                      <div class="u-name">{{ u.first_name }} {{ u.last_name }}</div>
                      <div class="text-muted text-sm hide-mobile">{{ u.username ? '@' + u.username : '—' }}</div>
                    </div>
                  </div>
                </td>
                <td class="hide-mobile"><code style="font-size:12px">{{ u.user_id }}</code></td>
                <td>
                  <span class="badge" :class="u.is_blocked ? 'badge-danger' : 'badge-success'">
                    {{ u.is_blocked ? (u.is_permanent_block ? '永久封禁' : '封禁') : '正常' }}
                  </span>
                </td>
                <td class="hide-mobile">
                  <span class="text-sm text-muted">{{ u.username || '—' }}</span>
                </td>
                <td class="hide-mobile text-muted text-sm">{{ fmtDate(u.created_at) }}</td>
                <td>
                  <div class="flex gap-1 flex-wrap">
                    <button v-if="!u.is_blocked" class="btn-danger btn-sm" @click.stop="blockOne(u)">封</button>
                    <button v-else class="btn-success btn-sm" @click.stop="unblockOne(u)">解封</button>
                    <button class="btn-ghost btn-sm" @click.stop="toggleWhitelistOne(u)" title="切换白名单">⚪</button>
                    <RouterLink :to="`/conversations?user=${u.user_id}`" class="btn-ghost btn-sm" style="text-decoration:none">消息</RouterLink>
                  </div>
                </td>
              </tr>
              <tr v-if="!displayUsers.length">
                <td colspan="7" class="text-center text-muted" style="padding:24px">暂无用户</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="total > pageSize">
          <button class="btn-ghost btn-sm" :disabled="page <= 1" @click="page--; load()">◀</button>
          <span class="text-muted text-sm">第 {{ page }} 页 · 共 {{ total }} 人</span>
          <button class="btn-ghost btn-sm" :disabled="page * pageSize >= total" @click="page++; load()">▶</button>
        </div>
      </template>
    </div>

    <!-- User Detail Modal -->
    <div v-if="detailUser" class="modal-overlay" @click.self="detailUser = null">
      <div class="modal-card card">
        <div class="modal-hdr">
          <div class="modal-ava">
            <img v-if="avatars[detailUser.user_id]" :src="avatars[detailUser.user_id]" class="ava-img" @error="avatars[detailUser.user_id] = ''" />
            <span v-else>{{ (detailUser.first_name || '?')[0].toUpperCase() }}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:17px;font-weight:700">{{ detailUser.first_name }} {{ detailUser.last_name }}</div>
            <div class="text-muted text-sm">{{ detailUser.username ? '@' + detailUser.username : '无用户名' }}</div>
          </div>
          <button class="btn-icon" @click="detailUser = null" style="font-size:20px">✕</button>
        </div>

        <div class="detail-grid">
          <div class="dr">
            <span class="dl">ID</span>
            <code>{{ detailUser.user_id }}</code>
            <button class="btn-ghost btn-sm copy-btn" @click="copyText(String(detailUser.user_id), 'UID')">复制</button>
          </div>
          <div class="dr"><span class="dl">状态</span>
            <span class="badge" :class="detailUser.is_blocked ? 'badge-danger' : 'badge-success'">
              {{ detailUser.is_blocked ? (detailUser.is_permanent_block ? '♾️ 永久封禁' : '⛔ 封禁') : '✅ 正常' }}
            </span>
          </div>
          <div class="dr" v-if="detailUser.block_reason"><span class="dl">封禁原因</span>{{ detailUser.block_reason }}</div>
          <div class="dr"><span class="dl">验证</span>{{ detailUser.is_verified ? '✅ 已验证' : '❌ 未验证' }}</div>
          <div class="dr"><span class="dl">白名单</span>{{ detailIsWl ? '⚪ 是' : '否' }}</div>
          <div class="dr">
            <span class="dl">姓名</span>
            <span>{{ detailUser.first_name }} {{ detailUser.last_name }}</span>
            <button class="btn-ghost btn-sm copy-btn" @click="copyText(`${detailUser.first_name || ''} ${detailUser.last_name || ''}`.trim(), '姓名')">复制</button>
          </div>
          <div class="dr"><span class="dl">语言</span>{{ detailUser.language_code || '未知' }}</div>
          <div class="dr"><span class="dl">首次联系</span>{{ fmtDate(detailUser.created_at) }}</div>
        </div>

        <div class="modal-acts">
          <button v-if="!detailUser.is_blocked" class="btn-danger" @click="blockDetail">🚫 封禁</button>
          <button v-else class="btn-success" @click="unblockDetail">✅ 解封</button>
          <button class="btn-ghost" @click="toggleWlDetail">{{ detailIsWl ? '移出白名单' : '⚪ 加白名单' }}</button>
          <RouterLink :to="`/conversations?user=${detailUser.user_id}`" class="btn-ghost" style="text-decoration:none" @click="detailUser = null">💬 消息</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'

const route = useRoute()
const users = ref([]), total = ref(0), page = ref(1), pageSize = 20
const loading = ref(true), filter = ref('')
const quickId = ref(''), quickReason = ref(''), quickMsg = ref(''), quickOk = ref(true)
const avatars = ref({})
const selected = ref([])
const detailUser = ref(null), detailIsWl = ref(false)

const displayUsers = computed(() => {
  if (filter.value === 'blocked') return users.value.filter(u => u.is_blocked)
  if (filter.value === 'normal') return users.value.filter(u => !u.is_blocked)
  return users.value
})
const allSelected = computed(() =>
  displayUsers.value.length > 0 && displayUsers.value.every(u => selected.value.includes(u.user_id))
)

function toggleAll(e) {
  selected.value = e.target.checked ? displayUsers.value.map(u => u.user_id) : []
}
function toggleSelect(uid) {
  const i = selected.value.indexOf(uid)
  if (i >= 0) selected.value.splice(i, 1); else selected.value.push(uid)
}

async function load() {
  loading.value = true
  try {
    const d = await api.get(`/api/users?page=${page.value}`)
    users.value = d.users; total.value = d.total; selected.value = []
    for (const u of d.users) loadAvatar(u.user_id)
  } finally { loading.value = false }
}

function loadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${uid}/avatar`
}

async function openDetail(u) {
  detailUser.value = { ...u }; detailIsWl.value = false
  loadAvatar(u.user_id)
  try { const r = await api.get(`/api/whitelist/check/${u.user_id}`); detailIsWl.value = r.whitelisted } catch {}
}

// Batch
function flash(msg, ok = true) { quickMsg.value = msg; quickOk.value = ok; setTimeout(() => quickMsg.value = '', 4000) }
async function batchBlock() {
  const reason = prompt('批量封禁原因（可留空）：'); if (reason === null) return
  await Promise.all(selected.value.map(uid => api.put(`/api/users/${uid}/block`, { reason, permanent: true })))
  flash(`✅ 已封禁 ${selected.value.length} 人`); selected.value = []; await load()
}
async function batchUnblock() {
  await Promise.all(selected.value.map(uid => api.put(`/api/users/${uid}/unblock`, {})))
  flash(`✅ 已解封 ${selected.value.length} 人`); selected.value = []; await load()
}
async function batchWhitelist() {
  await Promise.all(selected.value.map(uid => api.post(`/api/whitelist/${uid}`, { reason: '批量添加' })))
  flash(`✅ 已将 ${selected.value.length} 人加入白名单`); selected.value = []
}

// Single
async function quickBlock() { try { await api.put(`/api/users/${quickId.value}/block`, { reason: quickReason.value||'快速封禁', permanent: true }); flash(`✅ 已封禁`); await load() } catch(e) { flash('❌ '+e.message, false) } }
async function quickUnblock() { try { await api.put(`/api/users/${quickId.value}/unblock`, {}); flash(`✅ 已解封`); await load() } catch(e) { flash('❌ '+e.message, false) } }
async function quickWhitelist() { try { await api.post(`/api/whitelist/${quickId.value}`, { reason:'快速添加' }); flash('✅ 已加入白名单') } catch(e) { flash('❌ '+e.message, false) } }

async function blockOne(u) {
  const r = prompt('封禁原因：'); if (r === null) return
  await api.put(`/api/users/${u.user_id}/block`, { reason: r, permanent: true })
  u.is_blocked = 1; u.is_permanent_block = 1; u.block_reason = r
}
async function unblockOne(u) { await api.put(`/api/users/${u.user_id}/unblock`, {}); u.is_blocked = 0; u.is_permanent_block = 0 }
async function toggleWhitelistOne(u) {
  try {
    const r = await api.get(`/api/whitelist/check/${u.user_id}`)
    if (r.whitelisted) { await api.delete(`/api/whitelist/${u.user_id}`); flash('✅ 已移出白名单') }
    else { await api.post(`/api/whitelist/${u.user_id}`, { reason:'手动' }); flash('✅ 已加入白名单') }
  } catch(e) { flash('❌ '+e.message, false) }
}

// Detail modal
async function blockDetail() {
  const r = prompt('封禁原因：'); if (r === null) return
  await api.put(`/api/users/${detailUser.value.user_id}/block`, { reason: r, permanent: true })
  detailUser.value.is_blocked = 1; await load()
}
async function unblockDetail() { await api.put(`/api/users/${detailUser.value.user_id}/unblock`, {}); detailUser.value.is_blocked = 0; await load() }
async function toggleWlDetail() {
  if (detailIsWl.value) { await api.delete(`/api/whitelist/${detailUser.value.user_id}`); detailIsWl.value = false }
  else { await api.post(`/api/whitelist/${detailUser.value.user_id}`, { reason:'手动' }); detailIsWl.value = true }
}

async function copyText(text, label) {
  const val = String(text || '').trim()
  if (!val) return
  try {
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(val)
    else {
      const ta = document.createElement('textarea')
      ta.value = val
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    flash(`✅ 已复制${label}`)
  } catch (e) {
    flash(`❌ 复制失败: ${e?.message || '未知错误'}`, false)
  }
}

// UTC+8 precise to second
function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(new Date(ts).getTime() + 8 * 3600000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

watch(filter, () => { page.value = 1; load() })
watch(() => route.query.filter, (v) => {
  const next = v === 'blocked' || v === 'normal' ? v : ''
  if (filter.value !== next) filter.value = next
})
onMounted(() => {
  const qf = route.query.filter
  filter.value = qf === 'blocked' || qf === 'normal' ? qf : ''
  load()
})
</script>

<style scoped>
.quick-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.user-cell{display:flex;align-items:center;gap:10px}
.u-name{font-weight:500;font-size:13px;text-decoration:underline;text-decoration-color:transparent;transition:.15s}
.user-cell:hover .u-name{text-decoration-color:var(--accent)}
.u-ava{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;overflow:hidden}
.u-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.ava-img{width:100%;height:100%;object-fit:cover}
.cb{width:14px;height:14px;cursor:pointer;accent-color:var(--accent)}
.row-sel td{background:rgba(79,142,247,.07)!important}
.batch-bar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--accent-dim);border:1px solid rgba(79,142,247,.3);border-radius:var(--rs);flex-wrap:wrap}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
.modal-card{width:100%;max-width:440px;padding:24px;max-height:90vh;overflow-y:auto}
.modal-hdr{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.modal-ava{width:56px;height:56px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;overflow:hidden;flex-shrink:0}
.detail-grid{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.dr{display:flex;align-items:center;gap:10px;font-size:13px}
.dl{width:80px;flex-shrink:0;color:var(--text2);font-size:12px}
.modal-acts{display:flex;gap:8px;flex-wrap:wrap}
.modal-acts button,.modal-acts a{flex:1;min-width:70px;justify-content:center;font-size:12px;padding:7px 10px}
.copy-btn{padding:2px 8px;font-size:11px}
</style>
