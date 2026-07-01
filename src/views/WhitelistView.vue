<template>
  <v-container class="py-6" style="max-width:800px">
    <div class="d-flex align-center justify-space-between mb-5">
      <h2 class="text-h5 font-weight-bold d-flex align-center ga-2">
        <v-icon :icon="mdiShieldCheckOutline" size="28" />
        {{ t('whitelist.title') }}
      </h2>
      <v-btn variant="text" size="small" @click="load">
        <v-icon :icon="mdiRefresh" size="18" class="mr-1" />{{ t('whitelist.refresh') }}
      </v-btn>
    </div>

    <!-- 添加用户 -->
    <v-card class="mb-4 pa-4">
      <h3 class="text-subtitle-1 font-weight-bold d-flex align-center ga-2 mb-3">
        <v-icon :icon="mdiPlus" size="20" />{{ t('whitelist.addUser') }}
      </h3>
      <v-row dense>
        <v-col cols="12" sm="5">
          <UserSearchPicker v-model="addId" :placeholder="t('whitelist.search')" @selected="u => addId = String(u.user_id)" />
        </v-col>
        <v-col cols="12" sm="4">
          <v-text-field v-model="addReason" :placeholder="t('whitelist.reasonOptional')" density="comfortable" hide-details />
        </v-col>
        <v-col cols="12" sm="3">
          <v-btn block color="primary" :disabled="!addId || adding" :loading="adding" @click="doAdd">
            {{ t('whitelist.add') }}
          </v-btn>
        </v-col>
      </v-row>
      <v-alert v-if="addMsg" :type="addOk ? 'success' : 'error'" variant="tonal" class="mt-3" closable @click:close="addMsg = ''">
        {{ addMsg }}
      </v-alert>
      <p class="text-caption text-medium-emphasis mt-2">{{ t('whitelist.tip') }}</p>
    </v-card>

    <!-- 白名单表格 -->
    <v-card class="pa-4">
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <div v-else-if="!users.length" class="empty-state">
        <v-icon :icon="mdiShieldCheckOutline" size="48" />
        <span>{{ t('whitelist.empty') }}</span>
      </div>

      <v-table v-else density="compact">
        <thead>
          <tr>
            <th>{{ t('whitelist.table.user') }}</th>
            <th class="d-none d-sm-table-cell">{{ t('whitelist.table.telegramId') }}</th>
            <th>{{ t('whitelist.table.reason') }}</th>
            <th class="d-none d-sm-table-cell">{{ t('whitelist.table.addedAt') }}</th>
            <th>{{ t('whitelist.table.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.user_id">
            <td>
              <div class="d-flex align-center ga-2">
                <v-avatar color="primary" size="32" rounded="circle">
                  <span class="text-white text-caption font-weight-bold">{{ (u.first_name || u.username || '?')[0].toUpperCase() }}</span>
                </v-avatar>
                <div>
                  <div class="text-body-2 font-weight-medium">{{ u.first_name }} {{ u.last_name }}</div>
                  <div class="text-caption text-medium-emphasis">{{ u.username ? '@' + u.username : '—' }}</div>
                </div>
              </div>
            </td>
            <td class="d-none d-sm-table-cell"><code class="text-caption">{{ u.user_id }}</code></td>
            <td class="text-caption text-medium-emphasis">{{ u.reason || '—' }}</td>
            <td class="d-none d-sm-table-cell text-caption text-medium-emphasis">{{ fmtDate(u.created_at) }}</td>
            <td>
              <v-btn color="error" variant="tonal" size="x-small" @click="doRemove(u)">{{ t('whitelist.remove') }}</v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>

      <div v-if="total > pageSize" class="d-flex align-center justify-center ga-3 mt-3">
        <v-btn variant="text" size="small" :disabled="page <= 1" @click="page--; load()">◀</v-btn>
        <span class="text-caption text-medium-emphasis">{{ t('whitelist.pageInfo', { page, total }) }}</span>
        <v-btn variant="text" size="small" :disabled="page * pageSize >= total" @click="page++; load()">▶</v-btn>
      </div>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { mdiShieldCheckOutline, mdiRefresh, mdiPlus } from '@mdi/js'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'
import { useI18nStore } from '../stores/i18n'

const i18n = useI18nStore()
const t = i18n.t

const users = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(true)
const addId = ref('')
const addReason = ref('')
const addMsg = ref('')
const addOk = ref(true)
const adding = ref(false)

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
    addMsg.value = t('whitelist.addSuccess', { id: addId.value }); addOk.value = true
    addId.value = ''; addReason.value = ''
    await load()
  } catch (e) { addMsg.value = e.message; addOk.value = false }
  finally { adding.value = false; setTimeout(() => addMsg.value = '', 4000) }
}

async function doRemove(u) {
  if (!confirm(t('whitelist.removeConfirm', { id: u.user_id }))) return
  try {
    await api.delete(`/api/whitelist/${u.user_id}`)
    users.value = users.value.filter(x => x.user_id !== u.user_id)
    total.value--
  } catch (e) { alert(e.message) }
}

function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString() : '—' }
onMounted(load)
</script>
