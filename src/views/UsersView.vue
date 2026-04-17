<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title page-title-with-icon">
        <AppIcon name="users" :size="20" />
        {{ t('users.title') }}
      </h2>
      <div class="toolbar-controls">
        <select v-model="filter" class="toolbar-select">
          <option value="">{{ t('users.filter.all') }}</option>
          <option value="blocked">{{ t('users.filter.blocked') }}</option>
          <option value="normal">{{ t('users.filter.normal') }}</option>
        </select>
        <select v-model.number="pageSize" class="toolbar-select">
          <option v-for="size in pageSizeOptions" :key="size" :value="size">
            {{ t('users.pageSizeOption', { n: size }) }}
          </option>
        </select>
        <button class="btn-ghost btn-sm" @click="load">
          <AppIcon name="refresh" :size="14" />
        </button>
      </div>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title sec-title-with-icon">
        <AppIcon name="quick" :size="18" />
        {{ t('users.quickActions') }}
      </h3>
      <div class="quick-row">
        <UserSearchPicker v-model="quickId" :placeholder="t('users.searchUser')" @selected="u => quickId = String(u.user_id)" style="flex:1" />
        <input v-model="quickReason" :placeholder="t('users.reasonOptional')" style="flex:1" />
        <button class="btn-danger btn-sm" :disabled="!quickId" @click="quickBlock">
          <AppIcon name="block" :size="14" />
          {{ t('users.block') }}
        </button>
        <button class="btn-success btn-sm" :disabled="!quickId" @click="quickUnblock">
          <AppIcon name="unblock" :size="14" />
          {{ t('users.unblock') }}
        </button>
        <button class="btn-ghost btn-sm" :disabled="!quickId" @click="quickWhitelist">
          <AppIcon name="whitelist" :size="14" />
          {{ t('users.addWhitelist') }}
        </button>
      </div>
      <div v-if="quickMsg" class="alert mt-1" :class="quickOk ? 'alert-success' : 'alert-error'">{{ quickMsg }}</div>
    </div>

    <div v-if="selected.length" class="batch-bar mb-2">
      <span class="text-sm text-muted">{{ t('users.selectedCount', { n: selected.length }) }}</span>
      <div class="batch-actions flex gap-2 flex-wrap">
        <button class="btn-danger btn-sm" @click="batchBlock">
          <AppIcon name="block" :size="14" />
          {{ t('users.batchBlock') }}
        </button>
        <button class="btn-success btn-sm" @click="batchUnblock">
          <AppIcon name="unblock" :size="14" />
          {{ t('users.batchUnblock') }}
        </button>
        <button class="btn-ghost btn-sm" @click="batchWhitelist">
          <AppIcon name="whitelist" :size="14" />
          {{ t('users.batchWhitelist') }}
        </button>
        <button class="btn-ghost btn-sm" @click="selected = []">
          <AppIcon name="close" :size="14" />
          {{ t('users.cancel') }}
        </button>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
      <template v-else>
        <div style="overflow-x:auto">
          <table class="table compact-users-table">
            <thead>
              <tr>
                <th style="width:36px"><input type="checkbox" :checked="allSelected" @change="toggleAll" class="cb" /></th>
                <th>{{ t('users.table.user') }}</th>
                <th>{{ t('users.table.id') }}</th>
                <th>{{ t('users.table.status') }}</th>
                <th>{{ t('users.table.firstContact') }}</th>
                <th>{{ t('users.table.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.user_id" :class="{ 'row-sel': selected.includes(u.user_id) }">
                <td><input type="checkbox" :checked="selected.includes(u.user_id)" @change="toggleSelect(u.user_id)" class="cb" /></td>
                <td>
                  <div class="user-cell" @click="openDetail(u)">
                    <div class="u-ava" :class="{ blocked: u.is_blocked }">
                      <img v-if="avatars[u.user_id]" :src="avatars[u.user_id]" class="ava-img" @error="avatars[u.user_id] = ''" />
                      <span v-else>{{ (u.first_name || u.username || '?')[0].toUpperCase() }}</span>
                    </div>
                    <div class="user-summary">
                      <div class="u-name">{{ formatDisplayName(u) }}</div>
                      <div class="u-username">{{ u.username ? '@' + u.username : t('users.detail.noUsername') }}</div>
                    </div>
                  </div>
                </td>
                <td><code class="user-id">{{ u.user_id }}</code></td>
                <td>
                  <span class="badge" :class="u.is_blocked ? 'badge-danger' : 'badge-success'">
                    {{ u.is_blocked ? (u.is_permanent_block ? t('users.status.permanent') : t('users.status.blocked')) : t('users.status.normal') }}
                  </span>
                </td>
                <td class="text-muted text-sm">{{ fmtDate(u.created_at) }}</td>
                <td>
                  <div class="row-actions">
                    <button v-if="!u.is_blocked" class="btn-danger btn-sm" @click.stop="blockOne(u)">
                      <AppIcon name="block" :size="14" />
                    </button>
                    <button v-else class="btn-success btn-sm" @click.stop="unblockOne(u)">
                      <AppIcon name="unblock" :size="14" />
                    </button>
                    <button class="btn-ghost btn-sm" @click.stop="toggleWhitelistOne(u)" :title="t('users.addWhitelist')">
                      <AppIcon name="whitelist" :size="14" />
                    </button>
                    <RouterLink :to="`/conversations?user=${u.user_id}`" class="btn-ghost btn-sm action-link action-link-icon" :title="t('users.messages')">
                      <AppIcon name="conversations" :size="14" />
                    </RouterLink>
                  </div>
                </td>
              </tr>
              <tr v-if="!users.length">
                <td colspan="6" class="text-center text-muted" style="padding:24px">{{ t('users.empty') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pagination-bar" v-if="total > 0">
          <div class="pagination-meta">
            <span class="text-muted text-sm">{{ t('users.pageInfo', { page, total }) }}</span>
          </div>
          <div class="pagination-actions">
            <button class="btn-ghost btn-sm" :disabled="page <= 1" @click="goPrevPage">{{ t('users.prevPage') }}</button>
            <button class="btn-ghost btn-sm" :disabled="page >= totalPages" @click="goNextPage">{{ t('users.nextPage') }}</button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="detailUser" class="modal-overlay" @click.self="detailUser = null">
      <div class="modal-card card">
        <div class="modal-hdr">
          <div class="modal-ava">
            <img v-if="avatars[detailUser.user_id]" :src="avatars[detailUser.user_id]" class="ava-img" @error="avatars[detailUser.user_id] = ''" />
            <span v-else>{{ (detailUser.first_name || '?')[0].toUpperCase() }}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:17px;font-weight:700">{{ detailUser.first_name }} {{ detailUser.last_name }}</div>
            <div class="text-muted text-sm">{{ detailUser.username ? '@' + detailUser.username : t('users.detail.noUsername') }}</div>
          </div>
          <button class="btn-icon" @click="detailUser = null" style="font-size:20px">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="detail-grid">
          <div class="dr">
            <span class="dl">{{ t('users.detail.id') }}</span>
            <code>{{ detailUser.user_id }}</code>
            <button class="btn-ghost btn-sm copy-btn" @click="copyText(String(detailUser.user_id), t('users.copyUid'))">{{ t('users.copy') }}</button>
          </div>
          <div class="dr"><span class="dl">{{ t('users.detail.status') }}</span>
            <span class="badge" :class="detailUser.is_blocked ? 'badge-danger' : 'badge-success'">
              {{ detailUser.is_blocked ? (detailUser.is_permanent_block ? t('users.status.permanent') : t('users.status.blocked')) : t('users.status.normal') }}
            </span>
          </div>
          <div class="dr" v-if="detailUser.block_reason"><span class="dl">{{ t('users.detail.blockReason') }}</span>{{ detailUser.block_reason }}</div>
          <div class="dr"><span class="dl">{{ t('users.detail.verified') }}</span>{{ detailUser.is_verified ? t('users.detail.verified') : t('users.detail.unverified') }}</div>
          <div class="dr">
            <span class="dl">{{ t('users.detail.whitelist') }}</span>
            <span v-if="detailIsWl" class="inline-icon-text">
              <AppIcon name="whitelist" :size="14" />
              {{ t('common.yes') }}
            </span>
            <span v-else>{{ t('common.no') }}</span>
          </div>
          <div class="dr">
            <span class="dl">{{ t('users.detail.name') }}</span>
            <span>{{ detailUser.first_name }} {{ detailUser.last_name }}</span>
            <button class="btn-ghost btn-sm copy-btn" @click="copyText(`${detailUser.first_name || ''} ${detailUser.last_name || ''}`.trim(), t('users.copyName'))">{{ t('users.copy') }}</button>
          </div>
          <div class="dr"><span class="dl">{{ t('users.detail.language') }}</span>{{ detailUser.language_code || t('users.detail.unknown') }}</div>
          <div class="dr"><span class="dl">{{ t('users.detail.firstContact') }}</span>{{ fmtDate(detailUser.created_at) }}</div>
        </div>

        <div class="modal-acts">
          <button v-if="!detailUser.is_blocked" class="btn-danger" @click="blockDetail">
            <AppIcon name="block" :size="14" />
            {{ t('users.block') }}
          </button>
          <button v-else class="btn-success" @click="unblockDetail">
            <AppIcon name="unblock" :size="14" />
            {{ t('users.unblock') }}
          </button>
          <button class="btn-ghost" @click="toggleWlDetail">
            <AppIcon name="whitelist" :size="14" />
            {{ detailIsWl ? t('users.removeWhitelist') : t('users.addWhitelist') }}
          </button>
          <RouterLink :to="`/conversations?user=${detailUser.user_id}`" class="btn-ghost action-link" style="text-decoration:none" @click="detailUser = null">
            <AppIcon name="conversations" :size="14" />
            {{ t('users.messages') }}
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'
import { useI18nStore } from '../stores/i18n'

const route = useRoute()
const i18n = useI18nStore()
const t = i18n.t

const users = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const pageSizeOptions = [10, 20, 50, 100]
const loading = ref(true)
const filter = ref('')
const quickId = ref('')
const quickReason = ref('')
const quickMsg = ref('')
const quickOk = ref(true)
const avatars = ref({})
const selected = ref([])
const detailUser = ref(null)
const detailIsWl = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const allSelected = computed(() =>
  users.value.length > 0 && users.value.every(u => selected.value.includes(u.user_id)),
)

function formatDisplayName(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || (u.username ? '@' + u.username : String(u.user_id))
}

function toggleAll(e) {
  selected.value = e.target.checked ? users.value.map(u => u.user_id) : []
}

function toggleSelect(uid) {
  const i = selected.value.indexOf(uid)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(uid)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (filter.value) params.set('filter', filter.value)

    const d = await api.get(`/api/users?${params.toString()}`)
    users.value = Array.isArray(d?.users) ? d.users : []
    total.value = Number(d?.total || 0)
    selected.value = []
    for (const u of users.value) loadAvatar(u.user_id)

    if (page.value > totalPages.value) {
      page.value = totalPages.value
      await load()
    }
  } finally {
    loading.value = false
  }
}

function loadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${uid}/avatar`
}

async function openDetail(u) {
  detailUser.value = { ...u }
  detailIsWl.value = false
  loadAvatar(u.user_id)
  try {
    const r = await api.get(`/api/whitelist/check/${u.user_id}`)
    detailIsWl.value = r.whitelisted
  } catch {}
}

function flash(msg, ok = true) {
  quickMsg.value = msg
  quickOk.value = ok
  setTimeout(() => { quickMsg.value = '' }, 4000)
}

async function batchBlock() {
  const reason = prompt(t('users.batchBlockReasonPrompt'))
  if (reason === null) return
  await Promise.all(selected.value.map(uid => api.put(`/api/users/${uid}/block`, { reason, permanent: true })))
  flash(t('users.flash.blocked'))
  selected.value = []
  await load()
}

async function batchUnblock() {
  await Promise.all(selected.value.map(uid => api.put(`/api/users/${uid}/unblock`, {})))
  flash(t('users.flash.unblocked'))
  selected.value = []
  await load()
}

async function batchWhitelist() {
  await Promise.all(selected.value.map(uid => api.post(`/api/whitelist/${uid}`, { reason: 'batch' })))
  flash(t('users.flash.addedWhitelist'))
  selected.value = []
}

async function quickBlock() {
  try {
    await api.put(`/api/users/${quickId.value}/block`, { reason: quickReason.value || 'quick_block', permanent: true })
    flash(t('users.flash.blocked'))
    await load()
  } catch (e) {
    flash(e.message, false)
  }
}

async function quickUnblock() {
  try {
    await api.put(`/api/users/${quickId.value}/unblock`, {})
    flash(t('users.flash.unblocked'))
    await load()
  } catch (e) {
    flash(e.message, false)
  }
}

async function quickWhitelist() {
  try {
    await api.post(`/api/whitelist/${quickId.value}`, { reason: 'quick_add' })
    flash(t('users.flash.addedWhitelist'))
  } catch (e) {
    flash(e.message, false)
  }
}

async function blockOne(u) {
  const r = prompt(t('users.blockReasonPrompt'))
  if (r === null) return
  await api.put(`/api/users/${u.user_id}/block`, { reason: r, permanent: true })
  u.is_blocked = 1
  u.is_permanent_block = 1
  u.block_reason = r
}

async function unblockOne(u) {
  await api.put(`/api/users/${u.user_id}/unblock`, {})
  u.is_blocked = 0
  u.is_permanent_block = 0
}

async function toggleWhitelistOne(u) {
  try {
    const r = await api.get(`/api/whitelist/check/${u.user_id}`)
    if (r.whitelisted) {
      await api.delete(`/api/whitelist/${u.user_id}`)
      flash(t('users.flash.removedWhitelist'))
    } else {
      await api.post(`/api/whitelist/${u.user_id}`, { reason: 'manual' })
      flash(t('users.flash.addedWhitelist'))
    }
  } catch (e) {
    flash(e.message, false)
  }
}

async function blockDetail() {
  const r = prompt(t('users.blockReasonPrompt'))
  if (r === null) return
  await api.put(`/api/users/${detailUser.value.user_id}/block`, { reason: r, permanent: true })
  detailUser.value.is_blocked = 1
  await load()
}

async function unblockDetail() {
  await api.put(`/api/users/${detailUser.value.user_id}/unblock`, {})
  detailUser.value.is_blocked = 0
  await load()
}

async function toggleWlDetail() {
  if (detailIsWl.value) {
    await api.delete(`/api/whitelist/${detailUser.value.user_id}`)
    detailIsWl.value = false
  } else {
    await api.post(`/api/whitelist/${detailUser.value.user_id}`, { reason: 'manual' })
    detailIsWl.value = true
  }
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
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    flash(t('users.flash.copySuccess', { label }))
  } catch (e) {
    flash(t('users.flash.copyFailed', { err: e?.message || 'unknown' }), false)
  }
}

function goPrevPage() {
  if (page.value <= 1) return
  page.value -= 1
  load()
}

function goNextPage() {
  if (page.value >= totalPages.value) return
  page.value += 1
  load()
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(new Date(ts).getTime() + 8 * 3600000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

watch(filter, () => {
  page.value = 1
  load()
})

watch(pageSize, () => {
  page.value = 1
  load()
})

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
.page{max-width:980px;margin:0 auto}
.page-title-with-icon,
.sec-title-with-icon,
.inline-icon-text,
.action-link{display:inline-flex;align-items:center;gap:8px}
.toolbar-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.toolbar-select{width:auto;min-width:110px}
.quick-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.user-cell{display:flex;align-items:center;gap:10px;min-width:0;cursor:pointer}
.user-summary{min-width:0;display:flex;flex-direction:column;gap:2px}
.u-name{font-weight:600;font-size:13px;line-height:1.35;word-break:break-word}
.u-username{font-size:12px;color:var(--text2);line-height:1.35;word-break:break-word}
.u-ava{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;overflow:hidden}
.u-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.ava-img{width:100%;height:100%;object-fit:cover}
.user-id{font-size:12px;display:inline-block;max-width:130px;overflow:auto}
.cb{width:14px;height:14px;cursor:pointer;accent-color:var(--accent)}
.row-sel td{background:rgba(79,142,247,.07)!important}
.batch-bar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--accent-dim);border:1px solid rgba(79,142,247,.3);border-radius:var(--rs);flex-wrap:wrap}
.batch-actions{align-items:center}
.batch-actions button{white-space:nowrap}
.compact-users-table th,
.compact-users-table td{vertical-align:middle}
.row-actions{display:flex;align-items:center;gap:4px;flex-wrap:nowrap;white-space:nowrap}
.row-actions .btn-sm,
.row-actions .action-link{flex:0 0 auto}
.action-link-icon{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.pagination-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;flex-wrap:wrap}
.pagination-actions{display:flex;align-items:center;gap:8px}
@media (max-width:768px){
  .page{max-width:100%}
  .toolbar-controls{width:100%}
  .toolbar-select{flex:1;min-width:0}
  .batch-actions{width:100%}
  .batch-actions button{flex:0 1 auto;max-width:100%}
  .row-actions{gap:3px}
  .compact-users-table{min-width:760px}
}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
.modal-card{width:100%;max-width:440px;padding:24px;max-height:90vh;overflow-y:auto}
.modal-hdr{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.modal-ava{width:56px;height:56px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;overflow:hidden;flex-shrink:0}
.detail-grid{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.dr{display:flex;align-items:center;gap:10px;font-size:13px}
.dl{width:80px;flex-shrink:0;color:var(--text2);font-size:12px}
.modal-acts{display:flex;gap:8px;flex-wrap:wrap}
.modal-acts button,.modal-acts a{display:inline-flex;align-items:center;flex:1;min-width:70px;justify-content:center;font-size:12px;padding:7px 10px;border-radius:var(--rs);gap:6px}
.copy-btn{padding:2px 8px;font-size:11px}
</style>
