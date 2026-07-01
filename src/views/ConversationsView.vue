<template>
  <div class="d-flex" style="height:100%;overflow:hidden">
    <!-- 左侧对话列表 -->
    <v-sheet
      v-show="!isMobile || mobileView === 'list'"
      :width="isMobile ? '100%' : 300"
      :min-width="isMobile ? 0 : 300"
      class="d-flex flex-column border-e"
      style="height:100%"
      color="surface"
    >
      <div class="pa-3">
        <v-text-field
          v-model="search"
          :placeholder="t('conv.search')"
          prepend-inner-:icon="mdiMagnify"
          density="compact"
          variant="outlined"
          hide-details
          clearable
        />
      </div>
      <v-divider />
      <div class="flex-grow-1 overflow-y-auto">
        <v-progress-linear v-if="loadingList" indeterminate color="primary" />
        <div v-if="!filtered.length && !loadingList" class="empty-state" style="padding:32px">
          <span>{{ t('conv.empty') }}</span>
        </div>
        <v-list nav density="compact">
          <v-list-item
            v-for="c in filtered"
            :key="c.user_id"
            :active="selId === c.user_id"
            active-color="primary"
            @click="selectUser(c)"
          >
            <template #prepend>
              <v-avatar :color="c.is_blocked ? 'error' : 'primary'" size="38" rounded="circle" class="mr-3">
                <v-img v-if="avatars[c.user_id]" :src="avatars[c.user_id]" cover />
                <span v-else class="text-white font-weight-bold text-caption">{{ (c.first_name || c.username || '?')[0].toUpperCase() }}</span>
              </v-avatar>
            </template>
            <v-list-item-title class="d-flex align-center ga-1">
              <span class="text-truncate">{{ c.first_name || c.username || c.user_id }}</span>
              <v-chip v-if="c.is_blocked" color="error" size="x-small" variant="tonal">{{ t('conv.blockedTag') }}</v-chip>
            </v-list-item-title>
            <v-list-item-subtitle class="text-truncate">
              {{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || t('conv.noMessage') }}
            </v-list-item-subtitle>
            <template #append>
              <span class="text-caption text-medium-emphasis">{{ fmtShort(c.last_at) }}</span>
            </template>
          </v-list-item>
        </v-list>
      </div>
    </v-sheet>

    <!-- 右侧消息详情 -->
    <div v-show="!isMobile || mobileView === 'detail'" class="d-flex flex-column flex-grow-1" style="min-width:0;height:100%">
      <template v-if="selUser">
        <!-- 头部 -->
        <v-toolbar density="comfortable" color="surface" flat border>
          <v-btn v-if="isMobile" icon variant="text" size="small" @click="mobileView = 'list'">
            <v-icon :icon="mdiArrowLeft" />
          </v-btn>
          <v-avatar :color="selUser.is_blocked ? 'error' : 'primary'" size="36" rounded="circle" class="mr-3">
            <v-img v-if="avatars[selUser.user_id]" :src="avatars[selUser.user_id]" cover />
            <span v-else class="text-white font-weight-bold text-caption">{{ (selUser.first_name || '?')[0].toUpperCase() }}</span>
          </v-avatar>
          <v-toolbar-title>
            <div class="text-body-2 font-weight-medium">{{ selUser.first_name }} {{ selUser.last_name }}</div>
            <div class="text-caption text-medium-emphasis">ID: {{ selUser.user_id }}{{ selUser.username ? ' · @' + selUser.username : '' }}</div>
          </v-toolbar-title>
          <v-chip :color="selUser.is_blocked ? 'error' : 'success'" size="small" variant="tonal" class="mr-2">
            {{ selUser.is_blocked ? t('conv.status.blocked') : t('conv.status.normal') }}
          </v-chip>
          <v-btn v-if="!selUser.is_blocked" icon variant="text" size="small" color="error" @click="blockUser">
            <v-icon :icon="mdiBlockHelper" size="20" />
          </v-btn>
          <v-btn v-else icon variant="text" size="small" color="success" @click="unblockUser">
            <v-icon :icon="mdiCheckCircleOutline" size="20" />
          </v-btn>
          <v-btn icon variant="text" size="small" color="error" @click="deleteConv">
            <v-icon :icon="mdiDeleteOutline" size="20" />
          </v-btn>
        </v-toolbar>

        <!-- 消息列表 -->
        <div ref="msgRef" class="flex-grow-1 overflow-y-auto pa-4 d-flex flex-column ga-2">
          <v-progress-linear v-if="loadingMsgs" indeterminate color="primary" />
          <div v-if="!dedupedMsgs.length && !loadingMsgs" class="empty-state">
            <span>{{ t('conv.msgEmpty') }}</span>
          </div>
          <div v-for="m in dedupedMsgs" :key="m.id" :class="m.direction === 'incoming' ? 'd-flex' : 'd-flex justify-end'">
            <div :class="m.direction === 'incoming' ? 'msg-incoming' : 'msg-outgoing'">
              <div v-if="m.message_type && m.message_type !== 'text'" class="text-caption text-medium-emphasis mb-1">
                {{ typeLabel(m.message_type) }}
              </div>
              <div style="white-space:pre-wrap;word-break:break-word">{{ m.content || `[${typeLabel(m.message_type)}]` }}</div>
              <div class="text-caption text-medium-emphasis text-right mt-1" style="font-size:10px">{{ fmtFull(m.created_at) }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- 未选择占位 -->
      <div v-else class="empty-state flex-grow-1">
        <v-icon :icon="mdiMessageTextOutline" size="64" />
        <span>{{ t('conv.placeholder') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { mdiMagnify, mdiArrowLeft, mdiBlockHelper, mdiCheckCircleOutline, mdiDeleteOutline, mdiMessageTextOutline } from '@mdi/js'
import { useDisplay } from 'vuetify'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'
import { getLatestTimestamp, mergeByKey, readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const route = useRoute()
const i18n = useI18nStore()
const t = i18n.t
const { mobile: isMobile } = useDisplay()

const convs = ref([])
const msgs = ref([])
const selUser = ref(null)
const selId = ref(null)
const search = ref('')
const loadingList = ref(true)
const loadingMsgs = ref(false)
const msgRef = ref(null)
const mobileView = ref('list')
const avatars = ref({})
const msgRequestToken = ref(0)

const CONVERSATION_PAGE_SIZE = 50

const filtered = computed(() => {
  if (!search.value) return convs.value
  const q = search.value.toLowerCase()
  return convs.value.filter(c =>
    String(c.user_id).includes(q) || (c.first_name || '').toLowerCase().includes(q) || (c.username || '').toLowerCase().includes(q),
  )
})

const dedupedMsgs = computed(() => {
  const out = []
  for (const m of msgs.value) {
    const prev = out[out.length - 1]
    if (!prev) { out.push(m); continue }
    const sameDir = prev.direction === m.direction
    const sameType = (prev.message_type || 'text') === (m.message_type || 'text')
    const sameContent = String(prev.content || '') === String(m.content || '')
    const closeInTime = Math.abs(new Date(m.created_at || 0) - new Date(prev.created_at || 0)) <= 1500
    if (sameDir && sameType && sameContent && closeInTime) { out[out.length - 1] = m; continue }
    out.push(m)
  }
  return out
})

async function loadConvs() {
  loadingList.value = true
  const cached = readLocalCache('conversations:list')
  if (Array.isArray(cached) && cached.length) { convs.value = cached; loadingList.value = false; for (const c of cached) tryLoadAvatar(c.user_id) }
  try {
    const since = getLatestTimestamp(convs.value, 'last_at')
    const data = await api.get(`/api/conversations${since ? `?since=${encodeURIComponent(since)}` : ''}`)
    const items = Array.isArray(data?.items) ? data.items : []
    convs.value = since ? mergeByKey(convs.value, items, 'user_id', (a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0)) : items
    writeLocalCache('conversations:list', convs.value)
    for (const c of convs.value) tryLoadAvatar(c.user_id)
  } finally { loadingList.value = false }
}

function tryLoadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.src = `/api/users/${uid}/avatar`
}

async function selectUser(c) {
  const uid = c.user_id
  const token = ++msgRequestToken.value
  selId.value = uid; selUser.value = { ...c }; mobileView.value = 'detail'
  msgs.value = []; loadingMsgs.value = true
  try {
    let page = 1, detail = null
    const all = []
    while (true) {
      const d = await api.get(`/api/conversations/${uid}?page=${page}`)
      if (token !== msgRequestToken.value || selId.value !== uid) return
      if (!detail) detail = d
      const batch = Array.isArray(d?.messages) ? d.messages : []
      all.push(...batch)
      if (batch.length < CONVERSATION_PAGE_SIZE) break
      page++
    }
    selUser.value = detail?.user || c; msgs.value = all
    tryLoadAvatar(uid)
    updateConv(uid, { ...c, ...(detail?.user || {}) })
    await nextTick()
    if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
  } finally { if (token === msgRequestToken.value && selId.value === uid) loadingMsgs.value = false }
}

async function deleteConv() {
  if (!selUser.value) return
  const uid = selUser.value.user_id
  if (!confirm(t('conv.deleteConfirm', { name: selUser.value.first_name || uid }))) return
  try {
    const r = await api.delete(`/api/conversations/${uid}`)
    convs.value = convs.value.filter(c => c.user_id !== uid)
    writeLocalCache('conversations:list', convs.value)
    selUser.value = null; selId.value = null; msgs.value = []; mobileView.value = 'list'
    alert(r.reVerifyRequired ? t('conv.deleteSuccessReverify') : t('conv.deleteSuccessNoReverify'))
  } catch (e) { alert(t('conv.deleteFailed', { err: e.message })) }
}

async function blockUser() {
  const r = prompt(t('conv.blockReasonPrompt')); if (r === null) return
  await api.put(`/api/users/${selUser.value.user_id}/block`, { reason: r, permanent: true })
  selUser.value.is_blocked = 1; updateConv(selUser.value.user_id, { is_blocked: 1 })
}
async function unblockUser() {
  await api.put(`/api/users/${selUser.value.user_id}/unblock`, {})
  selUser.value.is_blocked = 0; updateConv(selUser.value.user_id, { is_blocked: 0 })
}
function updateConv(uid, patch) {
  const i = convs.value.findIndex(c => c.user_id === uid)
  if (i >= 0) { Object.assign(convs.value[i], patch); writeLocalCache('conversations:list', convs.value) }
  if (selUser.value?.user_id === uid) selUser.value = { ...selUser.value, ...patch }
}

function fmtShort(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts)
  if (diff < 60000) return t('conv.justNow')
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'
  return new Date(ts).toLocaleDateString()
}
function fmtFull(ts) {
  if (!ts) return ''
  const d = new Date(new Date(ts).getTime() + 8 * 3600000)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
function typeLabel(type) {
  return { photo: t('conv.type.photo'), video: t('conv.type.video'), audio: t('conv.type.audio'), voice: t('conv.type.voice'), document: t('conv.type.document'), sticker: t('conv.type.sticker'), animation: t('conv.type.animation'), video_note: t('conv.type.video_note'), contact: t('conv.type.contact'), location: t('conv.type.location'), poll: t('conv.type.poll'), dice: t('conv.type.dice') }[type] || type
}

onMounted(async () => {
  await loadConvs()
  if (route.query.user) { const c = convs.value.find(x => String(x.user_id) === String(route.query.user)); if (c) selectUser(c) }
})
</script>
