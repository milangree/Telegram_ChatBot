<template>
  <div class="conv-page">
    <div
      class="conv-left"
      :class="{ 'mobile-hidden': mobileView === 'detail' }"
    >
      <div class="left-search">
        <input
          v-model="search"
          :placeholder="t('conv.search')"
        >
      </div>
      <div class="left-list">
        <div
          v-if="loadingList"
          class="flex-center"
          style="padding:20px"
        >
          <div class="spinner" />
        </div>
        <template v-else>
          <div
            v-for="c in filtered"
            :key="c.user_id"
            class="left-item"
            :class="{ active: selId === c.user_id }"
            @click="selectUser(c)"
          >
            <div
              class="item-ava"
              :class="{ blocked: c.is_blocked }"
            >
              <img
                v-if="avatars[c.user_id]"
                :src="avatars[c.user_id]"
                class="ava-img"
                @error="avatars[c.user_id] = ''"
              >
              <span v-else>{{ (c.first_name || c.username || '?')[0].toUpperCase() }}</span>
            </div>
            <div class="item-body">
              <div class="item-line">
                <span class="item-name">{{ c.first_name || c.username || c.user_id }}</span>
                <span
                  v-if="c.is_blocked"
                  class="badge badge-danger"
                  style="font-size:9px"
                >{{ t('conv.blockedTag') }}</span>
                <span class="item-sep">·</span>
                <span class="item-preview">{{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || t('conv.noMessage') }}</span>
              </div>
            </div>
            <div class="item-time">
              {{ fmtShort(c.last_at) }}
            </div>
          </div>
          <div
            v-if="!filtered.length"
            class="empty-state"
          >
            <div class="empty-state-icon">
              <AppIcon
                name="conversations"
                :size="22"
              />
            </div>
            <div class="empty-state-title">
              {{ t('conv.empty') }}
            </div>
          </div>
        </template>
      </div>
    </div>

    <div
      class="conv-right"
      :class="{ 'mobile-hidden': mobileView === 'list' }"
    >
      <template v-if="selUser">
        <div class="right-header">
          <button
            class="btn-icon mobile-only"
            :title="t('users.prevPage')"
            @click="mobileView = 'list'"
          >
            <AppIcon
              name="back"
              :size="18"
            />
          </button>
          <div class="hdr-ava">
            <img
              v-if="avatars[selUser.user_id]"
              :src="avatars[selUser.user_id]"
              class="ava-img"
              @error="avatars[selUser.user_id] = ''"
            >
            <span v-else>{{ (selUser.first_name || '?')[0].toUpperCase() }}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="hdr-name">
              {{ selUser.first_name }} {{ selUser.last_name }}
            </div>
            <div class="hdr-meta text-muted text-sm">
              <span class="id-inline">
                <span class="id-label">{{ t('common.id') }}: </span>
                <button
                  type="button"
                  class="id-copy"
                  :title="t('common.copy')"
                  @click="copyTelegramId(selUser.user_id)"
                >{{ selUser.user_id }}</button>
              </span>
              <template v-if="selUser.username">
                <span class="hdr-sep"> · </span>
                <button
                  type="button"
                  class="id-copy"
                  :title="t('common.copy')"
                  @click="copyUsername(selUser.username)"
                >
                  @{{ selUser.username }}
                </button>
              </template>
            </div>
          </div>
          <span
            class="badge"
            :class="selUser.is_blocked ? 'badge-danger' : 'badge-success'"
          >
            {{ selUser.is_blocked ? t('conv.status.blocked') : t('conv.status.normal') }}
          </span>
          <button
            v-if="!selUser.is_blocked"
            class="btn-danger btn-sm"
            :title="t('users.blockUser')"
            @click="blockUser"
          >
            <AppIcon
              name="block"
              :size="14"
            />
          </button>
          <button
            v-else
            class="btn-success btn-sm"
            :title="t('users.unblockUser')"
            @click="unblockUser"
          >
            <AppIcon
              name="unblock"
              :size="14"
            />
          </button>
          <button
            class="btn-ghost btn-sm"
            :title="t('conv.deleteTitle')"
            @click="deleteConv"
          >
            <AppIcon
              name="delete"
              :size="14"
            />
          </button>
        </div>

        <div
          ref="msgRef"
          class="msg-list"
        >
          <div
            v-if="loadingMsgs"
            class="flex-center"
            style="padding:30px"
          >
            <div class="spinner" />
          </div>
          <template v-else>
            <div
              v-if="!dedupedMsgs.length"
              class="empty-state"
            >
              <div class="empty-state-icon">
                <AppIcon
                  name="inbox"
                  :size="22"
                />
              </div>
              <div class="empty-state-title">
                {{ t('conv.msgEmpty') }}
              </div>
            </div>
            <div
              v-for="m in dedupedMsgs"
              :key="m.id"
              class="msg-wrap"
              :class="m.direction"
            >
              <div
                class="msg-bubble"
                :class="{ 'msg-bubble--media': isVisualMedia(m) }"
              >
                <template v-if="isVisualMedia(m)">
                  <img
                    v-if="mediaFileId(m)"
                    class="msg-media"
                    :class="{ 'msg-media--sticker': m.message_type === 'sticker' }"
                    :src="mediaUrl(m)"
                    :alt="typeLabel(m.message_type)"
                    loading="lazy"
                    @error="onMediaError($event, m)"
                  >
                  <div
                    v-if="mediaCaption(m)"
                    class="msg-text msg-caption"
                  >
                    {{ mediaCaption(m) }}
                  </div>
                  <div
                    v-else-if="!mediaFileId(m)"
                    class="msg-text text-muted"
                  >
                    [{{ typeLabel(m.message_type) }}]
                  </div>
                </template>
                <template v-else>
                  <div
                    v-if="m.message_type && m.message_type !== 'text'"
                    class="msg-type-badge"
                  >
                    {{ typeLabel(m.message_type) }}
                  </div>
                  <div
                    v-if="displayText(m)"
                    class="msg-text"
                  >
                    {{ displayText(m) }}
                  </div>
                  <div
                    v-else-if="m.message_type !== 'text'"
                    class="msg-text text-muted"
                  >
                    [{{ typeLabel(m.message_type) }}]
                  </div>
                </template>
                <div class="msg-meta">
                  {{ fmtFull(m.created_at) }}
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="composer">
          <div
            v-if="pendingFile"
            class="composer-attach"
          >
            <span class="composer-attach-name">{{ pendingFile.name }}</span>
            <button
              type="button"
              class="btn-ghost btn-sm"
              @click="clearPendingFile"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
          <div class="composer-row">
            <input
              ref="fileInput"
              type="file"
              class="composer-file-input"
              accept="image/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.txt,.csv,application/*"
              @change="onPickFile"
            >
            <button
              type="button"
              class="btn-ghost btn-sm composer-icon-btn"
              :title="t('conv.attach')"
              :disabled="sending || !!selUser?.is_blocked"
              @click="fileInput?.click()"
            >
              <AppIcon
                name="add"
                :size="16"
              />
            </button>
            <textarea
              v-model="draft"
              class="composer-input"
              rows="1"
              :placeholder="selUser?.is_blocked ? t('conv.blockedHint') : t('conv.inputPh')"
              :disabled="sending || !!selUser?.is_blocked"
              @keydown.enter.exact.prevent="sendText"
            />
            <button
              type="button"
              class="btn-primary btn-sm composer-send-btn"
              :disabled="!canSend || sending || !!selUser?.is_blocked"
              @click="sendCurrent"
            >
              <span
                v-if="sending"
                class="spinner"
              />
              <template v-else>
                {{ t('conv.send') }}
              </template>
            </button>
          </div>
        </div>
      </template>
      <div
        v-else
        class="conv-placeholder"
      >
        <AppIcon
          name="conversations"
          :size="40"
          class="placeholder-icon"
        />
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
import { useDialog } from '../stores/dialog.js'
import { useToast } from '../stores/toast.js'
import { getLatestTimestamp, mergeByKey, readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const route = useRoute()
const i18n = useI18nStore()
const t = i18n.t
const dialog = useDialog()
const toast = useToast()

const convs = ref([]), msgs = ref([]), selUser = ref(null), selId = ref(null)
const search = ref(''), loadingList = ref(true), loadingMsgs = ref(false), msgRef = ref(null)
const mobileView = ref('list')
const avatars = ref({})
const msgRequestToken = ref(0)
const draft = ref('')
const sending = ref(false)
const pendingFile = ref(null)
const fileInput = ref(null)

const CONV_LIST_CACHE_KEY = 'conversations:list'
const CONVERSATION_PAGE_SIZE = 50

const canSend = computed(() => {
  if (pendingFile.value) return true
  return String(draft.value || '').trim().length > 0
})

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
  } catch (err) {
    console.warn('[Conversations] 列表加载失败:', err)
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
    // 默认加载第 1 页，废除阻塞性的 while(true)
    const detail = await api.get(`/api/conversations/${uid}?page=1`)
    if (requestToken !== msgRequestToken.value || selId.value !== uid) return

    const batch = Array.isArray(detail?.messages) ? detail.messages : []
    const nextUser = detail?.user || c

    selUser.value = nextUser
    msgs.value = batch

    tryLoadAvatar(uid)
    updateConv(uid, { ...c, ...(detail?.user || {}) })
    await scrollToBottom(true)
  } finally {
    if (requestToken === msgRequestToken.value && selId.value === uid) {
      loadingMsgs.value = false
      await scrollToBottom(true)
    }
  }
}

async function scrollToBottom(force = false) {
  await nextTick()
  // 再等一帧，确保消息 DOM 渲染完成
  await new Promise((r) => requestAnimationFrame(() => r()))
  const el = msgRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  if (force) {
    // 部分浏览器首次布局后高度会变，再补一次
    setTimeout(() => {
      if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
    }, 30)
  }
}

function onPickFile(e) {
  const file = e?.target?.files?.[0]
  if (!file) return
  if (file.size > 20 * 1024 * 1024) {
    toast.error(t('conv.fileTooLarge'))
    if (e?.target) e.target.value = ''
    return
  }
  pendingFile.value = file
}

function clearPendingFile() {
  pendingFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

async function sendText() {
  if (pendingFile.value) return sendCurrent()
  const text = String(draft.value || '').trim()
  if (!text || !selUser.value || sending.value || selUser.value.is_blocked) return
  sending.value = true
  try {
    const res = await api.post(`/api/conversations/${selUser.value.user_id}`, { kind: 'text', text })
    const msg = res?.message
    if (msg) {
      msgs.value = [...msgs.value, msg]
      updateConv(selUser.value.user_id, {
        last_message: text,
        last_direction: 'outgoing',
        last_at: msg.created_at || new Date().toISOString(),
      })
    }
    draft.value = ''
    await scrollToBottom(true)
  } catch (e) {
    toast.error(e.message || t('conv.sendFailed'))
  } finally {
    sending.value = false
  }
}

async function sendCurrent() {
  if (!selUser.value || sending.value || selUser.value.is_blocked) return
  if (pendingFile.value) return sendFile()
  return sendText()
}

async function sendFile() {
  const file = pendingFile.value
  if (!file || !selUser.value) return
  sending.value = true
  try {
    const form = new FormData()
    const isImage = String(file.type || '').startsWith('image/')
    form.append('kind', isImage ? 'photo' : 'document')
    form.append('file', file, file.name)
    const cap = String(draft.value || '').trim()
    if (cap) form.append('caption', cap)

    // axios 实例默认 application/json；multipart 需去掉 Content-Type 让浏览器带 boundary
    const res = await api.post(`/api/conversations/${selUser.value.user_id}`, form, {
      headers: { 'Content-Type': undefined },
      timeout: 120000,
    })
    const msg = res?.message
    if (msg) {
      msgs.value = [...msgs.value, msg]
      updateConv(selUser.value.user_id, {
        last_message: msg.content || file.name,
        last_direction: 'outgoing',
        last_at: msg.created_at || new Date().toISOString(),
      })
    }
    draft.value = ''
    clearPendingFile()
    await scrollToBottom(true)
  } catch (e) {
    toast.error(e.message || t('conv.sendFailed'))
  } finally {
    sending.value = false
  }
}

async function deleteConv() {
  if (!selUser.value) return
  const uid = selUser.value.user_id
  const name = selUser.value.first_name || uid
  const ok = await dialog.confirm({
    title: t('conv.deleteTitle'),
    message: t('conv.deleteConfirm', { name }),
    danger: true,
    confirmText: t('common.confirm'),
  })
  if (!ok) return
  try {
    const r = await api.delete(`/api/conversations/${uid}`)
    convs.value = convs.value.filter(c => c.user_id !== uid)
    writeLocalCache(CONV_LIST_CACHE_KEY, convs.value)
    selUser.value = null; selId.value = null; msgs.value = []
    mobileView.value = 'list'
    toast.success(r.reVerifyRequired ? t('conv.deleteSuccessReverify') : t('conv.deleteSuccessNoReverify'))
  } catch (e) {
    toast.error(t('conv.deleteFailed', { err: e.message }))
  }
}

async function blockUser() {
  const r = await dialog.prompt({
    title: t('users.blockUser'),
    message: t('conv.blockReasonPrompt'),
    defaultValue: '',
  })
  if (r === null) return
  try {
    await api.put(`/api/users/${selUser.value.user_id}/block`, { reason: r, permanent: true })
    selUser.value.is_blocked = 1
    updateConv(selUser.value.user_id, { is_blocked: 1 })
    toast.success(t('users.flash.blocked'))
  } catch (e) {
    toast.error(e.message || t('users.operationFailed'))
  }
}
async function unblockUser() {
  const ok = await dialog.confirm({
    title: t('users.unblockUser'),
    message: t('users.unblockConfirm', { name: formatConfirmName(selUser.value) }),
    confirmText: t('users.unblock'),
  })
  if (!ok) return
  try {
    await api.put(`/api/users/${selUser.value.user_id}/unblock`, {})
    selUser.value.is_blocked = 0
    updateConv(selUser.value.user_id, { is_blocked: 0 })
    toast.success(t('users.flash.unblocked'))
  } catch (e) {
    toast.error(e.message || t('users.operationFailed'))
  }
}

function formatConfirmName(u) {
  if (!u) return ''
  if (u.username) return `@${u.username}`
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || String(u.user_id || '')
}

async function copyTelegramId(id) {
  const val = String(id || '').trim()
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
    toast.success(t('users.flash.copySuccess', { label: t('users.copyUid') }))
  } catch (e) {
    toast.error(t('users.flash.copyFailed', { err: e?.message || 'unknown' }))
  }
}

async function copyUsername(username) {
  const raw = String(username || '').replace(/^@/, '').trim()
  if (!raw) return
  const val = `@${raw}`
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
    toast.success(t('users.flash.copySuccess', { label: t('users.copyUsername') }))
  } catch (e) {
    toast.error(t('users.flash.copyFailed', { err: e?.message || 'unknown' }))
  }
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
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
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

const VISUAL_TYPES = new Set(['photo', 'sticker', 'animation'])

function isVisualMedia(m) {
  return VISUAL_TYPES.has(String(m?.message_type || ''))
}

function unpackMedia(content) {
  const s = String(content || '')
  if (!s) return { fileId: '', caption: '' }
  const i = s.indexOf('\n')
  if (i < 0) {
    if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return { fileId: s, caption: '' }
    return { fileId: '', caption: s }
  }
  return { fileId: s.slice(0, i).trim(), caption: s.slice(i + 1) }
}

function mediaFileId(m) {
  if (!isVisualMedia(m)) return ''
  return unpackMedia(m?.content).fileId
}

function mediaCaption(m) {
  if (!isVisualMedia(m)) return ''
  return unpackMedia(m?.content).caption
}

function mediaUrl(m) {
  const id = mediaFileId(m)
  if (!id) return ''
  return `/api/tg/file?file_id=${encodeURIComponent(id)}`
}

function displayText(m) {
  const type = String(m?.message_type || 'text')
  const content = String(m?.content || '')
  if (!content) return ''
  if (type === 'text') return content
  if (isVisualMedia(m)) return mediaCaption(m)
  const { fileId, caption } = unpackMedia(content)
  if (fileId && caption) return caption
  if (content === t('conv.media') || content === '[photo]' || content === '[document]') return ''
  if (fileId && !caption && /^[A-Za-z0-9_-]{10,}$/.test(fileId)) return ''
  return content
}

function onMediaError(e) {
  const el = e?.target
  if (!el) return
  el.style.display = 'none'
  const fallback = document.createElement('div')
  fallback.className = 'msg-text text-muted'
  fallback.textContent = `[${typeLabel(el.closest('.msg-wrap')?.querySelector?.('.msg-type-badge')?.textContent) || t('conv.media')}]`
  // 简单占位
  fallback.textContent = `[${t('conv.media')}]`
  el.parentElement?.insertBefore(fallback, el)
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
.conv-page{
  display:flex;
  height:calc(100vh - 60px - 32px);
  min-height:520px;
  overflow:hidden;
  margin:0;
  background:var(--bg2);
  border:1px solid var(--border);
  border-radius:16px;
  box-shadow:var(--shadow);
}
@media(max-width:768px){
  .conv-page{height:calc(100vh - 56px - 16px);min-height:0;border-radius:12px}
  .mobile-hidden{display:none!important}
}
.conv-left{width:300px;min-width:300px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:color-mix(in srgb,var(--bg2) 96%, var(--bg3))}
@media(max-width:768px){.conv-left{width:100%;min-width:0}}
.left-search{padding:10px;border-bottom:1px solid var(--border)}
.left-search input{font-size:13px}
.left-list{flex:1;overflow-y:auto}
.left-item{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;transition:var(--tr);border-bottom:1px solid var(--border)}
.left-item:hover{background:var(--bg3);padding-left:16px}.left-item.active{background:var(--accent-dim)}
.item-ava{width:38px;height:38px;border-radius:50%;flex-shrink:0;background:var(--bg3);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;overflow:hidden}
.item-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.ava-img{width:100%;height:100%;object-fit:cover}
.item-body{flex:1;min-width:0}
.item-line{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}
.item-name{min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.item-preview{min-width:0;font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis}
.item-sep{color:var(--text3);flex-shrink:0}
.item-time{font-size:11px;color:var(--text3);flex-shrink:0}
.conv-right{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--bg)}
@media(max-width:768px){.conv-right{width:100%}}
.right-header{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--bg2);flex-shrink:0}
.hdr-ava{width:38px;height:38px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;overflow:hidden}
.hdr-name{font-weight:600;font-size:14px;line-height:1.3}
.hdr-meta{
  display:flex;align-items:center;gap:6px;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  line-height:1.4;
}
.hdr-username{flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;line-height:1.4}
.hdr-sep{flex-shrink:0;line-height:1.4}
/* id-copy / id-inline 样式由全局 style.css 统一提供 */
.msg-list{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-height:0}
.msg-wrap{display:flex}
.msg-wrap.incoming{justify-content:flex-start}
.msg-wrap.outgoing{justify-content:flex-end}
.msg-bubble{max-width:min(82%,100%);padding:9px 13px;border-radius:14px;font-size:13px;word-break:break-word;overflow-wrap:anywhere}
.incoming .msg-bubble{background:var(--bg3);border-bottom-left-radius:4px;transition:var(--tr)}
.incoming .msg-bubble:hover{background:color-mix(in srgb,var(--bg3),var(--accent) 6%)}
.outgoing .msg-bubble{background:var(--accent-dim);border:1px solid rgba(79,142,247,.25);border-bottom-right-radius:4px;transition:var(--tr)}
.outgoing .msg-bubble:hover{background:color-mix(in srgb,var(--accent-dim),var(--accent) 8%)}
.msg-type-badge{font-size:11px;color:var(--text3);margin-bottom:3px}
.msg-text{
  white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;
  font-family:inherit,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif;
}
.msg-caption{margin-top:6px}
.msg-bubble--media{padding:6px}
.msg-media{
  display:block;max-width:min(280px,70vw);max-height:320px;width:auto;height:auto;
  border-radius:10px;object-fit:contain;background:rgba(0,0,0,.04);
}
.msg-media--sticker{
  max-width:160px;max-height:160px;background:transparent;border-radius:0;
}
.msg-meta{font-size:10px;color:var(--text3);margin-top:4px;text-align:right}
.composer{
  flex-shrink:0;border-top:1px solid var(--border);background:var(--bg2);padding:10px 12px;display:flex;flex-direction:column;gap:8px;
}
.composer-row{display:flex;align-items:center;gap:8px;min-height:40px}
.composer-input{
  flex:1;min-width:0;resize:none;height:40px;min-height:40px;max-height:120px;padding:0 12px;
  border:1px solid var(--border);border-radius:var(--rs);background:var(--bg);color:var(--text);
  font:inherit;line-height:38px;box-sizing:border-box;
  font-family:inherit,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif;
}
.composer-input:focus{outline:none;border-color:var(--accent)}
.composer-file-input{display:none}
.composer-icon-btn{
  height:40px!important;width:40px!important;min-height:40px;min-width:40px;
  padding:0!important;margin:0;flex-shrink:0;
  display:inline-flex!important;align-items:center;justify-content:center;
  border-radius:var(--rs);box-sizing:border-box;line-height:1;
}
.composer-row > .btn-primary.btn-sm,
.composer-send-btn{
  height:40px!important;min-height:40px;min-width:64px;padding:0 14px!important;margin:0;flex-shrink:0;
  display:inline-flex!important;align-items:center;justify-content:center;
  border-radius:var(--rs);box-sizing:border-box;line-height:1;font-size:13px;
}
.composer-attach{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--text2);padding:4px 2px}
.composer-attach-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.conv-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text3)}
.placeholder-icon{color:var(--text3)}
.empty{text-align:center;color:var(--text3);font-size:13px;padding:30px}
</style>
