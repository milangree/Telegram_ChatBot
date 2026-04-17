<template>
  <div class="conv-page">
    <div class="conv-left" :class="{ 'mobile-hidden': mobileView === 'detail' }">
      <div class="left-search">
        <input v-model="search" :placeholder="t('conv.search')" />
      </div>
      <div class="left-list">
        <div v-if="loadingList" class="flex-center" style="padding:20px"><div class="spinner"></div></div>
        <template v-else>
          <div
            v-for="c in filtered"
            :key="c.user_id"
            class="left-item"
            :class="{ active: selId === c.user_id }"
            @click="selectUser(c)"
          >
            <div class="item-ava" :class="{ blocked: c.is_blocked }">
              <img v-if="avatars[c.user_id]" :src="avatars[c.user_id]" class="ava-img" @error="avatars[c.user_id] = ''" />
              <span v-else>{{ (c.first_name || c.username || '?')[0].toUpperCase() }}</span>
            </div>
            <div class="item-body">
              <div class="item-line">
                <span class="item-name">{{ c.first_name || c.username || c.user_id }}</span>
                <span v-if="c.is_blocked" class="badge badge-danger" style="font-size:9px">{{ t('conv.blockedTag') }}</span>
                <span class="item-sep">·</span>
                <span class="item-preview">{{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || t('conv.noMessage') }}</span>
              </div>
            </div>
            <div class="item-time">{{ fmtShort(c.last_at) }}</div>
          </div>
          <div v-if="!filtered.length" class="empty">{{ t('conv.empty') }}</div>
        </template>
      </div>
    </div>

    <div class="conv-right" :class="{ 'mobile-hidden': mobileView === 'list' }">
      <template v-if="selUser">
        <div class="right-header">
          <button class="btn-icon mobile-only" @click="mobileView = 'list'" style="font-size:18px">←</button>
          <div class="hdr-ava">
            <img v-if="avatars[selUser.user_id]" :src="avatars[selUser.user_id]" class="ava-img" @error="avatars[selUser.user_id] = ''" />
            <span v-else>{{ (selUser.first_name || '?')[0].toUpperCase() }}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="hdr-name">{{ selUser.first_name }} {{ selUser.last_name }}</div>
            <div class="text-muted text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ID: <code>{{ selUser.user_id }}</code>{{ selUser.username ? ' · @' + selUser.username : '' }}
            </div>
          </div>
          <span class="badge" :class="selUser.is_blocked ? 'badge-danger' : 'badge-success'">
            {{ selUser.is_blocked ? t('conv.status.blocked') : t('conv.status.normal') }}
          </span>
          <button v-if="!selUser.is_blocked" class="btn-danger btn-sm hide-mobile" @click="blockUser">
            <AppIcon name="block" :size="14" />
          </button>
          <button v-else class="btn-success btn-sm hide-mobile" @click="unblockUser">
            <AppIcon name="unblock" :size="14" />
          </button>
          <button class="btn-ghost btn-sm hide-mobile" @click="deleteConv" :title="t('conv.deleteTitle')">
            <AppIcon name="delete" :size="14" />
          </button>
          <button class="btn-ghost btn-sm mobile-only" @click="deleteConv" :title="t('conv.deleteTitle')">
            <AppIcon name="delete" :size="14" />
          </button>
        </div>

        <div class="msg-list" ref="msgRef">
          <div v-if="loadingMsgs" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
          <template v-else>
            <div v-if="!dedupedMsgs.length" class="empty">{{ t('conv.msgEmpty') }}</div>
            <div v-for="m in dedupedMsgs" :key="m.id" class="msg-wrap" :class="m.direction">
              <div class="msg-bubble">
                <div class="msg-type-badge" v-if="m.message_type && m.message_type !== 'text'">
                  {{ typeLabel(m.message_type) }}
                </div>
                <div class="msg-text" v-if="m.content && m.content !== t('conv.media')">{{ m.content }}</div>
                <div class="msg-text text-muted" v-else-if="m.message_type !== 'text'">[{{ typeLabel(m.message_type) }}]</div>
                <div class="msg-meta">{{ fmtFull(m.created_at) }}</div>
              </div>
            </div>
          </template>
        </div>
      </template>
      <div v-else class="conv-placeholder">
        <AppIcon name="conversations" :size="40" class="placeholder-icon" />
        <div>{{ t('conv.placeholder') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'
import { getLatestTimestamp, mergeByKey, readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const route = useRoute()
const i18n = useI18nStore()
const t = i18n.t

const convs = ref([]), msgs = ref([]), selUser = ref(null), selId = ref(null)
const search = ref(''), loadingList = ref(true), loadingMsgs = ref(false), msgRef = ref(null)
const mobileView = ref('list')
const avatars = ref({})
const msgRequestToken = ref(0)

const CONV_LIST_CACHE_KEY = 'conversations:list'

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
    if (!prev) {
      out.push(m)
      continue
    }

    const sameDirection = prev.direction === m.direction
    const sameType = (prev.message_type || 'text') === (m.message_type || 'text')
    const sameContent = String(prev.content || '') === String(m.content || '')
    const prevTime = new Date(prev.created_at || 0).getTime()
    const nextTime = new Date(m.created_at || 0).getTime()
    const closeInTime = Number.isFinite(prevTime) && Number.isFinite(nextTime) && Math.abs(nextTime - prevTime) <= 1500

    if (sameDirection && sameType && sameContent && closeInTime) {
      out[out.length - 1] = m
      continue
    }

    out.push(m)
  }
  return out
})

async function loadConvs() {
  loadingList.value = true

  const cached = readLocalCache(CONV_LIST_CACHE_KEY)
  if (Array.isArray(cached) && cached.length) {
    convs.value = cached
    loadingList.value = false
    for (const c of cached) tryLoadAvatar(c.user_id)
  }

  try {
    const since = getLatestTimestamp(convs.value, 'last_at')
    const query = since ? `?since=${encodeURIComponent(since)}` : ''
    const data = await api.get(`/api/conversations${query}`)
    const items = Array.isArray(data?.items) ? data.items : []

    convs.value = since
      ? mergeByKey(convs.value, items, 'user_id', (a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0))
      : items

    writeLocalCache(CONV_LIST_CACHE_KEY, convs.value)

    for (const c of convs.value) tryLoadAvatar(c.user_id)
  } finally { loadingList.value = false }
}

function tryLoadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${uid}/avatar`
}

async function selectUser(c) {
  const uid = c.user_id
  const requestToken = ++msgRequestToken.value

  selId.value = uid
  selUser.value = { ...c }
  mobileView.value = 'detail'

  msgs.value = []
  loadingMsgs.value = true

  try {
    const d = await api.get(`/api/conversations/${uid}`)

    if (requestToken !== msgRequestToken.value || selId.value !== uid) return

    const incomingMessages = Array.isArray(d?.messages) ? d.messages : []
    const nextUser = d.user || c

    selUser.value = nextUser
    msgs.value = incomingMessages

    tryLoadAvatar(uid)
    updateConv(uid, { ...c, ...(d.user || {}) })
    await nextTick()
    if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
  } finally {
    if (requestToken === msgRequestToken.value && selId.value === uid) {
      loadingMsgs.value = false
    }
  }
}

async function deleteConv() {
  if (!selUser.value) return
  const uid = selUser.value.user_id
  const name = selUser.value.first_name || uid
  if (!confirm(t('conv.deleteConfirm', { name }))) return
  try {
    const r = await api.delete(`/api/conversations/${uid}`)
    convs.value = convs.value.filter(c => c.user_id !== uid)
    writeLocalCache(CONV_LIST_CACHE_KEY, convs.value)
    selUser.value = null; selId.value = null; msgs.value = []
    mobileView.value = 'list'
    if (r.reVerifyRequired) alert(t('conv.deleteSuccessReverify'))
    else alert(t('conv.deleteSuccessNoReverify'))
  } catch (e) { alert(t('conv.deleteFailed', { err: e.message })) }
}

async function blockUser() {
  const r = prompt(t('conv.blockReasonPrompt')) ?? ''
  if (r === null) return
  await api.put(`/api/users/${selUser.value.user_id}/block`, { reason: r, permanent: true })
  selUser.value.is_blocked = 1
  updateConv(selUser.value.user_id, { is_blocked: 1 })
}
async function unblockUser() {
  await api.put(`/api/users/${selUser.value.user_id}/unblock`, {})
  selUser.value.is_blocked = 0
  updateConv(selUser.value.user_id, { is_blocked: 0 })
}
function updateConv(uid, patch) {
  const i = convs.value.findIndex(c => c.user_id === uid)
  if (i >= 0) {
    Object.assign(convs.value[i], patch)
    writeLocalCache(CONV_LIST_CACHE_KEY, convs.value)
  }
  if (selUser.value?.user_id === uid) {
    selUser.value = { ...selUser.value, ...patch }
  }
}

function fmtShort(ts) {
  if (!ts) return ''
  const d = new Date(ts), diff = Date.now() - d
  if (diff < 60000) return t('conv.justNow')
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'
  return d.toLocaleDateString('zh-CN')
}
function fmtFull(ts) {
  if (!ts) return ''
  const d = new Date(new Date(ts).getTime() + 8 * 3600000)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
function typeLabel(type) {
  return {
    photo: t('conv.type.photo'),
    video: t('conv.type.video'),
    audio: t('conv.type.audio'),
    voice: t('conv.type.voice'),
    document: t('conv.type.document'),
    sticker: t('conv.type.sticker'),
    animation: t('conv.type.animation'),
    video_note: t('conv.type.video_note'),
    contact: t('conv.type.contact'),
    location: t('conv.type.location'),
    poll: t('conv.type.poll'),
    dice: t('conv.type.dice'),
  }[type] || type
}

onMounted(async () => {
  await loadConvs()
  if (route.query.user) {
    const c = convs.value.find(x => String(x.user_id) === String(route.query.user))
    if (c) selectUser(c)
  }
})
</script>

<style scoped>
.conv-page{display:flex;height:calc(100vh - 48px);margin:-24px;overflow:hidden}
@media(max-width:768px){.conv-page{margin:-16px;height:calc(100vh - 50px)}.mobile-hidden{display:none!important}}
.conv-left{width:280px;min-width:280px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg2)}
@media(max-width:768px){.conv-left{width:100%;min-width:0}}
.left-search{padding:10px;border-bottom:1px solid var(--border)}
.left-search input{font-size:13px}
.left-list{flex:1;overflow-y:auto}
.left-item{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;transition:var(--tr);border-bottom:1px solid var(--border)}
.left-item:hover{background:var(--bg3)}.left-item.active{background:var(--accent-dim)}
.item-ava{width:38px;height:38px;border-radius:50%;flex-shrink:0;background:var(--bg3);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;overflow:hidden}
.item-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.ava-img{width:100%;height:100%;object-fit:cover}
.item-body{flex:1;min-width:0}
.item-line{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}
.item-name{min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.item-preview{min-width:0;font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis}
.item-sep{color:var(--text3);flex-shrink:0}
.item-time{font-size:11px;color:var(--text3);flex-shrink:0}
.conv-right{flex:1;display:flex;flex-direction:column;min-width:0}
@media(max-width:768px){.conv-right{width:100%}}
.right-header{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--bg2);flex-shrink:0}
.hdr-ava{width:38px;height:38px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;overflow:hidden}
.hdr-name{font-weight:600;font-size:14px}
.msg-list{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.msg-wrap{display:flex}
.msg-wrap.incoming{justify-content:flex-start}
.msg-wrap.outgoing{justify-content:flex-end}
.msg-bubble{max-width:min(82%,100%);padding:9px 13px;border-radius:14px;font-size:13px;word-break:break-word;overflow-wrap:anywhere}
.incoming .msg-bubble{background:var(--bg3);border-bottom-left-radius:4px}
.outgoing .msg-bubble{background:var(--accent-dim);border:1px solid rgba(79,142,247,.25);border-bottom-right-radius:4px}
.msg-type-badge{font-size:11px;color:var(--text3);margin-bottom:3px}
.msg-text{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.msg-meta{font-size:10px;color:var(--text3);margin-top:4px;text-align:right}
.conv-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text3)}
.placeholder-icon{color:var(--text3)}
.empty{text-align:center;color:var(--text3);font-size:13px;padding:30px}
</style>
