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
        <button class="btn-ghost btn-sm" @click="load" :title="t('dashboard.refresh')">
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
                  <div class="user-cell" :class="{ 'is-blocked': !!u.is_blocked, 'is-wl': !!wlMap[u.user_id] && !u.is_blocked }" @click="openDetail(u)">
                    <div class="u-ava" :class="{ blocked: u.is_blocked }">
                      <img v-if="avatars[u.user_id]" :src="avatars[u.user_id]" class="ava-img" @error="avatars[u.user_id] = ''" />
                      <span v-else>{{ (u.first_name || u.username || '?')[0].toUpperCase() }}</span>
                    </div>
                    <div class="user-summary">
                      <div class="u-name">
                        {{ formatDisplayName(u) }}
                        <span v-if="wlMap[u.user_id] && !u.is_blocked" class="wl-inline-tag">{{ t('users.detail.whitelist') }}</span>
                      </div>
                      <div class="u-username">{{ u.username ? '@' + u.username : t('users.detail.noUsername') }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <button type="button" class="id-copy" :title="t('common.copy')" @click.stop="copyText(String(u.user_id), t('users.copyUid'))">
                    <code class="user-id">{{ u.user_id }}</code>
                  </button>
                </td>
                <td>
                  <span class="badge" :class="u.is_blocked ? 'badge-danger' : 'badge-success'">
                    {{ u.is_blocked ? (u.is_permanent_block ? t('users.status.permanent') : t('users.status.blocked')) : t('users.status.normal') }}
                  </span>
                </td>
                <td class="text-muted text-sm">{{ fmtDate(u.created_at) }}</td>
                <td>
                  <div class="row-actions">
                    <button v-if="!u.is_blocked" class="btn-danger btn-sm" @click.stop="blockOne(u)" :title="t('users.blockUser')">
                      <AppIcon name="block" :size="14" />
                    </button>
                    <button v-else class="btn-success btn-sm" @click.stop="unblockOne(u)" :title="t('users.unblockUser')">
                      <AppIcon name="unblock" :size="14" />
                    </button>
                    <button
                      class="btn-sm"
                      :class="wlMap[u.user_id] ? 'btn-danger' : 'btn-ghost'"
                      @click.stop="toggleWhitelistOne(u)"
                      :title="wlMap[u.user_id] ? t('users.removeWhitelist') : t('users.addWhitelist')"
                    >
                      <AppIcon name="whitelist" :size="14" />
                    </button>
                    <button class="btn-danger btn-sm" @click.stop="deleteOne(u)" :title="t('users.delete')">
                      <AppIcon name="delete" :size="14" />
                    </button>
                    <RouterLink :to="`/conversations?user=${u.user_id}`" class="btn-ghost btn-sm action-link action-link-icon" :title="t('users.messages')">
                      <AppIcon name="conversations" :size="14" />
                    </RouterLink>
                  </div>
                </td>
              </tr>
              <tr v-if="!users.length">
                <td colspan="6">
                  <div class="empty-state">
                    <div class="empty-state-icon"><AppIcon name="users" :size="24" /></div>
                    <div class="empty-state-title">{{ t('users.empty') }}</div>
                  </div>
                </td>
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
            <button type="button" class="id-copy" :title="t('common.copy')" @click="copyText(String(detailUser.user_id), t('users.copyUid'))">
              <code>{{ detailUser.user_id }}</code>
            </button>
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
          <button class="btn-ghost" :class="{ 'btn-danger': detailIsWl }" @click="toggleWlDetail">
            <AppIcon name="whitelist" :size="14" />
            {{ detailIsWl ? t('users.removeWhitelist') : t('users.addWhitelist') }}
          </button>
          <button class="btn-danger" @click="deleteDetail">
            <AppIcon name="delete" :size="14" />
            {{ t('users.delete') }}
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
import { useDialog } from '../stores/dialog.js'
import { useToast } from '../stores/toast.js'

const route = useRoute()
const i18n = useI18nStore()
const t = i18n.t
const dialog = useDialog()
const toast = useToast()

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
const wlMap = ref({})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const allSelected = computed(() =>
  users.value.length > 0 && users.value.every(u => selected.value.includes(u.user_id)),
)

function formatDisplayName(u) {
  if (!u) return ''
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || (u.username ? `@${u.username}` : String(u.user_id))
}

/** 确认弹窗用：优先 @username，否则 姓+名，最后才回退 ID */
function formatConfirmName(uOrId, fallbackUser) {
  const u = (uOrId && typeof uOrId === 'object')
    ? uOrId
    : (fallbackUser || users.value.find(x => String(x.user_id) === String(uOrId)) || { user_id: uOrId })
  if (u.username) return `@${u.username}`
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || String(u.user_id || uOrId || '')
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
    loadWhitelistFlags(users.value)

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

async function loadWhitelistFlags(list) {
  const next = { ...wlMap.value }
  await Promise.all((Array.isArray(list) ? list : []).map(async (u) => {
    // 封禁用户不显示白名单标识
    if (u.is_blocked) {
      next[u.user_id] = false
      return
    }
    try {
      const r = await api.get(`/api/whitelist/check/${u.user_id}`)
      next[u.user_id] = !!r.whitelisted
    } catch {
      next[u.user_id] = false
    }
  }))
  wlMap.value = next
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
  // 保留顶部快速操作区反馈，同时弹出全局 Toast
  quickMsg.value = msg
  quickOk.value = ok
  setTimeout(() => { quickMsg.value = '' }, 4000)
  if (ok) toast.success(msg)
  else toast.error(msg)
}

async function batchBlock() {
  const reason = await dialog.prompt({
    title: t('users.batchBlock'),
    message: t('users.batchBlockReasonPrompt'),
    defaultValue: '',
  })
  if (reason === null) return
  try {
    const results = await Promise.allSettled(
      selected.value.map(uid => api.put(`/api/users/${uid}/block`, { reason, permanent: true })),
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed) flash(t('users.flash.partialFailed', { n: failed }), false)
    else flash(t('users.flash.blocked'))
    selected.value = []
    await load()
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function batchUnblock() {
  const ok = await dialog.confirm({
    title: t('users.batchUnblock'),
    message: t('users.batchUnblockConfirm', { n: selected.value.length }),
    confirmText: t('users.batchUnblock'),
  })
  if (!ok) return
  try {
    const results = await Promise.allSettled(
      selected.value.map(uid => api.put(`/api/users/${uid}/unblock`, {})),
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed) flash(t('users.flash.partialFailed', { n: failed }), false)
    else flash(t('users.flash.unblocked'))
    selected.value = []
    await load()
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function batchWhitelist() {
  const ok = await dialog.confirm({
    title: t('users.batchWhitelist'),
    message: t('users.batchWhitelistConfirm', { n: selected.value.length }),
    confirmText: t('users.batchWhitelist'),
  })
  if (!ok) return
  try {
    const results = await Promise.allSettled(
      selected.value.map(uid => api.post(`/api/whitelist/${uid}`, { reason: 'batch' })),
    )
    const failed = results.filter(r => r.status === 'rejected').length
    // 同步本地白名单状态（仅成功项）
    const next = { ...wlMap.value }
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') next[selected.value[i]] = true
    })
    wlMap.value = next
    if (failed) flash(t('users.flash.partialFailed', { n: failed }), false)
    else flash(t('users.flash.addedWhitelist'))
    selected.value = []
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function quickBlock() {
  const ok = await dialog.confirm({
    title: t('users.blockUser'),
    message: t('users.quickBlockConfirm', { name: formatConfirmName(quickId.value) }),
    danger: true,
    confirmText: t('users.block'),
  })
  if (!ok) return
  try {
    await api.put(`/api/users/${quickId.value}/block`, { reason: quickReason.value || 'quick_block', permanent: true })
    flash(t('users.flash.blocked'))
    await load()
  } catch (e) {
    flash(e.message, false)
  }
}

async function quickUnblock() {
  const ok = await dialog.confirm({
    title: t('users.unblockUser'),
    message: t('users.quickUnblockConfirm', { name: formatConfirmName(quickId.value) }),
    confirmText: t('users.unblock'),
  })
  if (!ok) return
  try {
    await api.put(`/api/users/${quickId.value}/unblock`, {})
    flash(t('users.flash.unblocked'))
    await load()
  } catch (e) {
    flash(e.message, false)
  }
}

async function quickWhitelist() {
  const ok = await dialog.confirm({
    title: t('users.addWhitelist'),
    message: t('users.quickWhitelistConfirm', { name: formatConfirmName(quickId.value) }),
    confirmText: t('users.addWhitelist'),
  })
  if (!ok) return
  try {
    await api.post(`/api/whitelist/${quickId.value}`, { reason: 'quick_add' })
    wlMap.value = { ...wlMap.value, [quickId.value]: true }
    flash(t('users.flash.addedWhitelist'))
  } catch (e) {
    flash(e.message, false)
  }
}

async function blockOne(u) {
  const r = await dialog.prompt({
    title: t('users.blockUser'),
    message: t('users.blockReasonPrompt'),
    defaultValue: '',
  })
  if (r === null) return
  try {
    await api.put(`/api/users/${u.user_id}/block`, { reason: r, permanent: true })
    u.is_blocked = 1
    u.is_permanent_block = 1
    u.block_reason = r
    flash(t('users.flash.blocked'))
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function unblockOne(u) {
  const ok = await dialog.confirm({
    title: t('users.unblockUser'),
    message: t('users.unblockConfirm', { name: formatConfirmName(u) }),
    confirmText: t('users.unblock'),
  })
  if (!ok) return
  try {
    await api.put(`/api/users/${u.user_id}/unblock`, {})
    u.is_blocked = 0
    u.is_permanent_block = 0
    flash(t('users.flash.unblocked'))
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function toggleWhitelistOne(u) {
  const isWl = !!wlMap.value[u.user_id]
  if (isWl) {
    // 已是白名单：只允许移出，并必须确认
    const ok = await dialog.confirm({
      title: t('users.removeWhitelist'),
      message: t('users.removeWhitelistConfirm', { name: formatConfirmName(u) }),
      danger: true,
      confirmText: t('users.removeWhitelist'),
    })
    if (!ok) return
    try {
      await api.delete(`/api/whitelist/${u.user_id}`)
      wlMap.value = { ...wlMap.value, [u.user_id]: false }
      if (detailUser.value?.user_id === u.user_id) detailIsWl.value = false
      flash(t('users.flash.removedWhitelist'))
    } catch (e) {
      flash(e.message, false)
    }
    return
  }

  // 未在白名单：设置为白名单，需确认
  const ok = await dialog.confirm({
    title: t('users.addWhitelist'),
    message: t('users.addWhitelistConfirm', { name: formatConfirmName(u) }),
    confirmText: t('users.addWhitelist'),
  })
  if (!ok) return
  try {
    await api.post(`/api/whitelist/${u.user_id}`, { reason: 'manual' })
    wlMap.value = { ...wlMap.value, [u.user_id]: true }
    if (detailUser.value?.user_id === u.user_id) detailIsWl.value = true
    flash(t('users.flash.addedWhitelist'))
  } catch (e) {
    flash(e.message, false)
  }
}

async function blockDetail() {
  const r = await dialog.prompt({
    title: t('users.blockUser'),
    message: t('users.blockReasonPrompt'),
    defaultValue: '',
  })
  if (r === null) return
  try {
    await api.put(`/api/users/${detailUser.value.user_id}/block`, { reason: r, permanent: true })
    detailUser.value.is_blocked = 1
    flash(t('users.flash.blocked'))
    await load()
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function unblockDetail() {
  const ok = await dialog.confirm({
    title: t('users.unblockUser'),
    message: t('users.unblockConfirm', { name: formatConfirmName(detailUser.value) }),
    confirmText: t('users.unblock'),
  })
  if (!ok) return
  try {
    await api.put(`/api/users/${detailUser.value.user_id}/unblock`, {})
    detailUser.value.is_blocked = 0
    flash(t('users.flash.unblocked'))
    await load()
  } catch (e) {
    flash(e.message || t('users.operationFailed'), false)
  }
}

async function toggleWlDetail() {
  if (detailIsWl.value) {
    const ok = await dialog.confirm({
      title: t('users.removeWhitelist'),
      message: t('users.removeWhitelistConfirm', { name: formatConfirmName(detailUser.value) }),
      danger: true,
      confirmText: t('users.removeWhitelist'),
    })
    if (!ok) return
    try {
      await api.delete(`/api/whitelist/${detailUser.value.user_id}`)
      detailIsWl.value = false
      wlMap.value = { ...wlMap.value, [detailUser.value.user_id]: false }
      flash(t('users.flash.removedWhitelist'))
    } catch (e) {
      flash(e.message, false)
    }
    return
  }

  const ok = await dialog.confirm({
    title: t('users.addWhitelist'),
    message: t('users.addWhitelistConfirm', { name: formatConfirmName(detailUser.value) }),
    confirmText: t('users.addWhitelist'),
  })
  if (!ok) return
  try {
    await api.post(`/api/whitelist/${detailUser.value.user_id}`, { reason: 'manual' })
    detailIsWl.value = true
    wlMap.value = { ...wlMap.value, [detailUser.value.user_id]: true }
    flash(t('users.flash.addedWhitelist'))
  } catch (e) {
    flash(e.message, false)
  }
}

async function deleteOne(u) {
  const ok = await dialog.confirm({
    title: t('users.delete'),
    message: t('users.deleteConfirm', { id: u.user_id }),
    danger: true,
    confirmText: t('users.delete'),
  })
  if (!ok) return
  try {
    await api.delete(`/api/users/${u.user_id}`)
    flash(t('users.flash.deleted'))
    if (detailUser.value?.user_id === u.user_id) detailUser.value = null
    await load()
  } catch (e) {
    flash(e.message, false)
  }
}

async function deleteDetail() {
  if (!detailUser.value) return
  const ok = await dialog.confirm({
    title: t('users.delete'),
    message: t('users.deleteConfirm', { id: detailUser.value.user_id }),
    danger: true,
    confirmText: t('users.delete'),
  })
  if (!ok) return
  try {
    await api.delete(`/api/users/${detailUser.value.user_id}`)
    flash(t('users.flash.deleted'))
    detailUser.value = null
    await load()
  } catch (e) {
    flash(e.message, false)
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
.u-ava{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;overflow:hidden;position:relative}
.u-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.user-cell.is-blocked .wl-inline-tag{display:none!important}
.wl-inline-tag{
  display:inline-flex;margin-left:6px;font-size:10px;font-weight:600;color:var(--accent);
  background:var(--accent-dim);padding:1px 6px;border-radius:999px;vertical-align:middle;align-items:center;
}
.ava-img{width:100%;height:100%;object-fit:cover}
.user-id{
  font-size:12px;
  display:inline-block;
  background:transparent!important;
  border-radius:0;
  padding:0;
  max-width:none;
  overflow:visible;
  letter-spacing:.02em;
  font-variant-numeric:tabular-nums;
}
.id-copy{
  appearance:none;border:1px solid var(--border);background:var(--bg3);padding:5px 10px;margin:0;cursor:pointer;
  color:var(--text2);font:inherit;display:inline-flex;align-items:center;justify-content:center;
  min-width:118px;border-radius:8px;transition:var(--tr);line-height:1.2;
}
.id-copy:hover{
  color:var(--accent);border-color:rgba(79,142,247,.35);background:var(--accent-dim);
}
.id-copy:hover code{color:var(--accent)}
.id-copy:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
:global(:root.glass) .id-copy{
  background:rgba(255,255,255,.06);
  border-color:rgba(255,255,255,.12);
}
:global(:root.light.glass) .id-copy{
  background:rgba(15,23,42,.04);
  border-color:rgba(148,163,184,.28);
}
.cb{
  width:14px;
  height:14px;
  min-width:14px;
  min-height:14px;
  margin:0;
  padding:0;
  cursor:pointer;
  accent-color:var(--accent);
  background:transparent !important;
  border:none !important;
  box-shadow:none !important;
  -webkit-backdrop-filter:none !important;
  backdrop-filter:none !important;
  filter:none;
  transform:translateZ(0);
  vertical-align:middle;
}
/* 表头全选框：在毛玻璃卡片上单独提升合成层，避免顶部描边被滤镜糊掉 */
.compact-users-table thead .cb{
  position:relative;
  z-index:1;
}
.row-sel td{background:rgba(79,142,247,.07)!important}
:global(:root.glass) .row-sel td{background:rgba(79,142,247,.12)!important}
.batch-bar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--accent-dim);border:1px solid rgba(79,142,247,.3);border-radius:var(--rs);flex-wrap:wrap}
:global(:root.glass) .batch-bar{
  background:linear-gradient(180deg, rgba(79,142,247,.18), rgba(79,142,247,.08));
  border-color:rgba(79,142,247,.35);
}
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
.modal-hdr{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.modal-ava{width:56px;height:56px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;overflow:hidden;flex-shrink:0}
.detail-grid{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.dr{display:flex;align-items:center;gap:10px;font-size:13px}
.dl{width:80px;flex-shrink:0;color:var(--text2);font-size:12px}
.modal-acts{display:flex;gap:8px;flex-wrap:wrap}
.modal-acts button,.modal-acts a{display:inline-flex;align-items:center;flex:1;min-width:70px;justify-content:center;font-size:12px;padding:7px 10px;border-radius:var(--rs);gap:6px}
.copy-btn{padding:2px 8px;font-size:11px}
</style>
