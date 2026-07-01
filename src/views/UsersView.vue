<template>
  <v-container class="py-6" style="max-width:1000px">
    <!-- 标题栏 -->
    <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-5">
      <h2 class="text-h5 font-weight-bold d-flex align-center ga-2">
        <v-icon :icon="mdiAccountGroupOutline" size="28" />
        {{ t('users.title') }}
      </h2>
      <div class="d-flex align-center ga-2 flex-wrap">
        <v-select v-model="filter" :items="filterOptions" item-title="label" item-value="value" density="compact" variant="outlined" hide-details style="min-width:120px" />
        <v-select v-model.number="pageSize" :items="pageSizeOptions" density="compact" variant="outlined" hide-details style="min-width:100px" />
        <v-btn variant="text" icon size="small" @click="load"><v-icon :icon="mdiRefresh" /></v-btn>
      </div>
    </div>

    <!-- 快速操作 -->
    <v-card class="mb-4 pa-4">
      <h3 class="text-subtitle-1 font-weight-bold d-flex align-center ga-2 mb-3">
        <v-icon :icon="mdiLightningBolt" size="20" />{{ t('users.quickActions') }}
      </h3>
      <v-row dense>
        <v-col cols="12" sm="4"><UserSearchPicker v-model="quickId" :placeholder="t('users.searchUser')" @selected="u => quickId = String(u.user_id)" /></v-col>
        <v-col cols="12" sm="3"><v-text-field v-model="quickReason" :placeholder="t('users.reasonOptional')" density="comfortable" hide-details /></v-col>
        <v-col cols="12" sm="5" class="d-flex ga-2 flex-wrap">
          <v-btn color="error" variant="tonal" size="small" :disabled="!quickId" @click="quickBlock">{{ t('users.block') }}</v-btn>
          <v-btn color="success" variant="tonal" size="small" :disabled="!quickId" @click="quickUnblock">{{ t('users.unblock') }}</v-btn>
          <v-btn variant="tonal" size="small" :disabled="!quickId" @click="quickWhitelist">{{ t('users.addWhitelist') }}</v-btn>
        </v-col>
      </v-row>
      <v-alert v-if="quickMsg" :type="quickOk ? 'success' : 'error'" variant="tonal" class="mt-3" closable @click:close="quickMsg = ''">{{ quickMsg }}</v-alert>
    </v-card>

    <!-- 批量操作 -->
    <v-expand-transition>
      <v-card v-if="selected.length" color="primary" variant="tonal" class="mb-4 pa-3 d-flex align-center ga-2 flex-wrap">
        <span class="text-body-2">{{ t('users.selectedCount', { n: selected.length }) }}</span>
        <v-spacer />
        <v-btn color="error" variant="tonal" size="small" @click="batchBlock">{{ t('users.batchBlock') }}</v-btn>
        <v-btn color="success" variant="tonal" size="small" @click="batchUnblock">{{ t('users.batchUnblock') }}</v-btn>
        <v-btn variant="tonal" size="small" @click="batchWhitelist">{{ t('users.batchWhitelist') }}</v-btn>
        <v-btn variant="text" size="small" @click="selected = []">{{ t('users.cancel') }}</v-btn>
      </v-card>
    </v-expand-transition>

    <!-- 用户表格 -->
    <v-card class="pa-4">
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <v-table v-else density="compact" hover>
        <thead>
          <tr>
            <th style="width:40px"><v-checkbox-btn :model-value="allSelected" @update:model-value="toggleAll" /></th>
            <th>{{ t('users.table.user') }}</th>
            <th>{{ t('users.table.id') }}</th>
            <th>{{ t('users.table.status') }}</th>
            <th class="d-none d-sm-table-cell">{{ t('users.table.firstContact') }}</th>
            <th>{{ t('users.table.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.user_id" :class="{ 'bg-primary-lighten-4': selected.includes(u.user_id) }">
            <td><v-checkbox-btn :model-value="selected.includes(u.user_id)" @update:model-value="toggleSelect(u.user_id)" /></td>
            <td>
              <div class="d-flex align-center ga-2 cursor-pointer" @click="openDetail(u)">
                <v-avatar :color="u.is_blocked ? 'error' : 'primary'" size="34" rounded="circle">
                  <v-img v-if="avatars[u.user_id]" :src="avatars[u.user_id]" cover />
                  <span v-else class="text-white font-weight-bold text-caption">{{ (u.first_name || u.username || '?')[0].toUpperCase() }}</span>
                </v-avatar>
                <div>
                  <div class="text-body-2 font-weight-medium">{{ formatDisplayName(u) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ u.username ? '@' + u.username : t('users.detail.noUsername') }}</div>
                </div>
              </div>
            </td>
            <td><code class="text-caption">{{ u.user_id }}</code></td>
            <td>
              <v-chip :color="u.is_blocked ? 'error' : 'success'" size="x-small" variant="tonal">
                {{ u.is_blocked ? (u.is_permanent_block ? t('users.status.permanent') : t('users.status.blocked')) : t('users.status.normal') }}
              </v-chip>
            </td>
            <td class="d-none d-sm-table-cell text-caption text-medium-emphasis">{{ fmtDate(u.created_at) }}</td>
            <td>
              <div class="d-flex ga-1">
                <v-btn v-if="!u.is_blocked" icon variant="text" size="x-small" color="error" @click.stop="blockOne(u)"><v-icon :icon="mdiBlockHelper" size="18" /></v-btn>
                <v-btn v-else icon variant="text" size="x-small" color="success" @click.stop="unblockOne(u)"><v-icon :icon="mdiCheckCircleOutline" size="18" /></v-btn>
                <v-btn icon variant="text" size="x-small" @click.stop="toggleWhitelistOne(u)"><v-icon :icon="mdiShieldCheckOutline" size="18" /></v-btn>
                <v-btn icon variant="text" size="x-small" color="error" @click.stop="deleteOne(u)"><v-icon :icon="mdiDeleteOutline" size="18" /></v-btn>
                <v-btn :to="`/conversations?user=${u.user_id}`" icon variant="text" size="x-small"><v-icon :icon="mdiMessageTextOutline" size="18" /></v-btn>
              </div>
            </td>
          </tr>
          <tr v-if="!users.length"><td colspan="6" class="text-center text-medium-emphasis py-6">{{ t('users.empty') }}</td></tr>
        </tbody>
      </v-table>

      <div v-if="total > 0" class="d-flex align-center justify-space-between mt-3">
        <span class="text-caption text-medium-emphasis">{{ t('users.pageInfo', { page, total }) }}</span>
        <v-pagination v-model="page" :length="totalPages" density="compact" rounded="lg" @update:model-value="load" />
      </div>
    </v-card>

    <!-- 用户详情弹窗 -->
    <v-dialog v-model="showDetail" max-width="480">
      <v-card v-if="detailUser" class="pa-5">
        <div class="d-flex align-center ga-3 mb-4">
          <v-avatar :color="detailUser.is_blocked ? 'error' : 'primary'" size="56" rounded="circle">
            <v-img v-if="avatars[detailUser.user_id]" :src="avatars[detailUser.user_id]" cover />
            <span v-else class="text-white font-weight-bold text-h6">{{ (detailUser.first_name || '?')[0].toUpperCase() }}</span>
          </v-avatar>
          <div class="flex-grow-1">
            <div class="text-h6 font-weight-bold">{{ detailUser.first_name }} {{ detailUser.last_name }}</div>
            <div class="text-caption text-medium-emphasis">{{ detailUser.username ? '@' + detailUser.username : t('users.detail.noUsername') }}</div>
          </div>
          <v-btn icon variant="text" @click="showDetail = false"><v-icon :icon="mdiClose" /></v-btn>
        </div>

        <v-table density="compact">
          <tbody>
            <tr><td class="text-medium-emphasis" style="width:100px">{{ t('users.detail.id') }}</td><td><code>{{ detailUser.user_id }}</code></td></tr>
            <tr><td class="text-medium-emphasis">{{ t('users.detail.status') }}</td><td><v-chip :color="detailUser.is_blocked ? 'error' : 'success'" size="x-small" variant="tonal">{{ detailUser.is_blocked ? (detailUser.is_permanent_block ? t('users.status.permanent') : t('users.status.blocked')) : t('users.status.normal') }}</v-chip></td></tr>
            <tr v-if="detailUser.block_reason"><td class="text-medium-emphasis">{{ t('users.detail.blockReason') }}</td><td>{{ detailUser.block_reason }}</td></tr>
            <tr><td class="text-medium-emphasis">{{ t('users.detail.verified') }}</td><td>{{ detailUser.is_verified ? t('common.yes') : t('common.no') }}</td></tr>
            <tr><td class="text-medium-emphasis">{{ t('users.detail.whitelist') }}</td><td><v-chip v-if="detailIsWl" color="success" size="x-small" variant="tonal">{{ t('common.yes') }}</v-chip><span v-else>{{ t('common.no') }}</span></td></tr>
            <tr><td class="text-medium-emphasis">{{ t('users.detail.language') }}</td><td>{{ detailUser.language_code || '—' }}</td></tr>
            <tr><td class="text-medium-emphasis">{{ t('users.detail.firstContact') }}</td><td>{{ fmtDate(detailUser.created_at) }}</td></tr>
          </tbody>
        </v-table>

        <v-divider class="my-3" />

        <div class="d-flex ga-2 flex-wrap">
          <v-btn v-if="!detailUser.is_blocked" color="error" variant="tonal" size="small" @click="blockDetail">{{ t('users.block') }}</v-btn>
          <v-btn v-else color="success" variant="tonal" size="small" @click="unblockDetail">{{ t('users.unblock') }}</v-btn>
          <v-btn variant="tonal" size="small" @click="toggleWlDetail">{{ detailIsWl ? t('users.removeWhitelist') : t('users.addWhitelist') }}</v-btn>
          <v-btn color="error" variant="tonal" size="small" @click="deleteDetail">{{ t('users.delete') }}</v-btn>
          <v-btn :to="`/conversations?user=${detailUser.user_id}`" variant="tonal" size="small" @click="showDetail = false">{{ t('users.messages') }}</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- 消息提示 -->
    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="4000" location="bottom end">
      {{ snackbarMsg }}
    </v-snackbar>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { mdiAccountGroupOutline, mdiRefresh, mdiLightningBolt, mdiBlockHelper, mdiCheckCircleOutline, mdiShieldCheckOutline, mdiDeleteOutline, mdiMessageTextOutline, mdiClose } from '@mdi/js'
import { useRoute } from 'vue-router'
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
const avatars = ref({})
const selected = ref([])
const detailUser = ref(null)
const detailIsWl = ref(false)
const showDetail = ref(false)
const snackbar = ref(false)
const snackbarMsg = ref('')
const snackbarColor = ref('success')

const filterOptions = computed(() => [
  { value: '', label: t('users.filter.all') },
  { value: 'blocked', label: t('users.filter.blocked') },
  { value: 'normal', label: t('users.filter.normal') },
])
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const allSelected = computed(() => users.value.length > 0 && users.value.every(u => selected.value.includes(u.user_id)))

function formatDisplayName(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || (u.username ? '@' + u.username : String(u.user_id))
}

function flash(msg, ok = true) { snackbarMsg.value = msg; snackbarColor.value = ok ? 'success' : 'error'; snackbar.value = true }
function toggleAll(v) { selected.value = v ? users.value.map(u => u.user_id) : [] }
function toggleSelect(uid) { const i = selected.value.indexOf(uid); i >= 0 ? selected.value.splice(i, 1) : selected.value.push(uid) }

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) })
    if (filter.value) params.set('filter', filter.value)
    const d = await api.get(`/api/users?${params.toString()}`)
    users.value = Array.isArray(d?.users) ? d.users : []
    total.value = Number(d?.total || 0)
    selected.value = []
    for (const u of users.value) loadAvatar(u.user_id)
  } finally { loading.value = false }
}

function loadAvatar(uid) {
  const img = new Image(); img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }; img.src = `/api/users/${uid}/avatar`
}

async function openDetail(u) {
  detailUser.value = { ...u }; detailIsWl.value = false; showDetail.value = true
  loadAvatar(u.user_id)
  try { const r = await api.get(`/api/whitelist/check/${u.user_id}`); detailIsWl.value = r.whitelisted } catch {}
}

async function quickBlock() { try { await api.put(`/api/users/${quickId.value}/block`, { reason: quickReason.value || 'quick_block', permanent: true }); flash(t('users.flash.blocked')); await load() } catch (e) { flash(e.message, false) } }
async function quickUnblock() { try { await api.put(`/api/users/${quickId.value}/unblock`, {}); flash(t('users.flash.unblocked')); await load() } catch (e) { flash(e.message, false) } }
async function quickWhitelist() { try { await api.post(`/api/whitelist/${quickId.value}`, { reason: 'quick_add' }); flash(t('users.flash.addedWhitelist')) } catch (e) { flash(e.message, false) } }

async function batchBlock() { const r = prompt(t('users.batchBlockReasonPrompt')); if (r === null) return; await Promise.all(selected.value.map(uid => api.put(`/api/users/${uid}/block`, { reason: r, permanent: true }))); flash(t('users.flash.blocked')); selected.value = []; await load() }
async function batchUnblock() { await Promise.all(selected.value.map(uid => api.put(`/api/users/${uid}/unblock`, {}))); flash(t('users.flash.unblocked')); selected.value = []; await load() }
async function batchWhitelist() { await Promise.all(selected.value.map(uid => api.post(`/api/whitelist/${uid}`, { reason: 'batch' }))); flash(t('users.flash.addedWhitelist')); selected.value = [] }

async function blockOne(u) { const r = prompt(t('users.blockReasonPrompt')); if (r === null) return; await api.put(`/api/users/${u.user_id}/block`, { reason: r, permanent: true }); u.is_blocked = 1; u.is_permanent_block = 1 }
async function unblockOne(u) { await api.put(`/api/users/${u.user_id}/unblock`, {}); u.is_blocked = 0; u.is_permanent_block = 0 }
async function toggleWhitelistOne(u) { try { const r = await api.get(`/api/whitelist/check/${u.user_id}`); if (r.whitelisted) { await api.delete(`/api/whitelist/${u.user_id}`); flash(t('users.flash.removedWhitelist')) } else { await api.post(`/api/whitelist/${u.user_id}`, { reason: 'manual' }); flash(t('users.flash.addedWhitelist')) } } catch (e) { flash(e.message, false) } }
async function deleteOne(u) { if (!confirm(t('users.deleteConfirm', { id: u.user_id }))) return; try { await api.delete(`/api/users/${u.user_id}`); flash(t('users.flash.deleted')); if (detailUser.value?.user_id === u.user_id) showDetail.value = false; await load() } catch (e) { flash(e.message, false) } }

async function blockDetail() { const r = prompt(t('users.blockReasonPrompt')); if (r === null) return; await api.put(`/api/users/${detailUser.value.user_id}/block`, { reason: r, permanent: true }); detailUser.value.is_blocked = 1; await load() }
async function unblockDetail() { await api.put(`/api/users/${detailUser.value.user_id}/unblock`, {}); detailUser.value.is_blocked = 0; await load() }
async function toggleWlDetail() { if (detailIsWl.value) { await api.delete(`/api/whitelist/${detailUser.value.user_id}`); detailIsWl.value = false } else { await api.post(`/api/whitelist/${detailUser.value.user_id}`, { reason: 'manual' }); detailIsWl.value = true } }
async function deleteDetail() { if (!detailUser.value || !confirm(t('users.deleteConfirm', { id: detailUser.value.user_id }))) return; try { await api.delete(`/api/users/${detailUser.value.user_id}`); flash(t('users.flash.deleted')); showDetail.value = false; await load() } catch (e) { flash(e.message, false) } }

function fmtDate(ts) { if (!ts) return '—'; const d = new Date(new Date(ts).getTime() + 8 * 3600000); const pad = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }

watch(filter, () => { page.value = 1; load() })
watch(pageSize, () => { page.value = 1; load() })
watch(() => route.query.filter, (v) => { const next = v === 'blocked' || v === 'normal' ? v : ''; if (filter.value !== next) filter.value = next })

onMounted(() => { const qf = route.query.filter; filter.value = qf === 'blocked' || qf === 'normal' ? qf : ''; load() })
</script>
