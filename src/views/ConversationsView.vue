<template>
  <div class="conv-page">
    <div class="conv-left">
      <div class="left-search">
        <input v-model="search" placeholder="🔍 搜索用户…" />
      </div>
      <div class="left-list">
        <div v-if="loadingList" class="flex-center" style="padding:20px"><div class="spinner"></div></div>
        <template v-else>
          <div v-for="c in filtered" :key="c.user_id"
            class="left-item" :class="{active: selId===c.user_id}"
            @click="selectUser(c)">
            <div class="item-ava" :class="{blocked:c.is_blocked}">{{ (c.first_name||c.username||'?')[0].toUpperCase() }}</div>
            <div class="item-body">
              <div class="item-name">{{ c.first_name||c.username||c.user_id }}<span v-if="c.is_blocked" class="badge badge-danger" style="font-size:9px;margin-left:4px">封</span></div>
              <div class="item-preview">{{ c.last_message||'无消息' }}</div>
            </div>
            <div class="item-time">{{ fmtShort(c.last_at) }}</div>
          </div>
          <div v-if="!filtered.length" class="empty">暂无对话</div>
        </template>
      </div>
    </div>

    <div class="conv-right">
      <template v-if="selUser">
        <div class="right-header">
          <div class="hdr-info">
            <div class="hdr-ava">{{ (selUser.first_name||'?')[0].toUpperCase() }}</div>
            <div>
              <div class="hdr-name">{{ selUser.first_name }} {{ selUser.last_name }}</div>
              <div class="text-muted text-sm">ID: <code>{{ selUser.user_id }}</code>{{ selUser.username?' · @'+selUser.username:'' }}</div>
            </div>
          </div>
          <div class="hdr-actions">
            <span class="badge" :class="selUser.is_blocked?'badge-danger':'badge-success'">{{ selUser.is_blocked?'⛔ 已封禁':'✅ 正常' }}</span>
            <button v-if="!selUser.is_blocked" class="btn-danger btn-sm" @click="blockUser">🚫 封禁</button>
            <button v-else class="btn-success btn-sm" @click="unblockUser">✅ 解封</button>
          </div>
        </div>

        <div class="msg-list" ref="msgRef">
          <div v-if="loadingMsgs" class="flex-center" style="padding:30px"><div class="spinner"></div></div>
          <template v-else>
            <div v-if="!msgs.length" class="empty">暂无消息记录</div>
            <div v-for="m in msgs" :key="m.id" class="msg-wrap" :class="m.direction">
              <div class="msg-bubble">
                <div class="msg-text">{{ m.content }}</div>
                <div class="msg-meta">{{ m.message_type!=='text'?`[${typeLabel(m.message_type)}] `:'' }}{{ fmtFull(m.created_at) }}</div>
              </div>
            </div>
          </template>
        </div>
      </template>
      <div v-else class="conv-placeholder">
        <div style="font-size:48px">💬</div>
        <div>选择左侧对话查看消息记录</div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import api from '../stores/api.js'

const route = useRoute()
const convs = ref([]), msgs = ref([]), selUser = ref(null), selId = ref(null)
const search = ref(''), loadingList = ref(true), loadingMsgs = ref(false), msgRef = ref(null)

const filtered = computed(() => {
  if (!search.value) return convs.value
  const q = search.value.toLowerCase()
  return convs.value.filter(c => String(c.user_id).includes(q)||(c.first_name||'').toLowerCase().includes(q)||(c.username||'').toLowerCase().includes(q))
})

async function loadConvs() {
  loadingList.value = true
  try { convs.value = await api.get('/api/conversations') } finally { loadingList.value = false }
}
async function selectUser(c) {
  selId.value = c.user_id; loadingMsgs.value = true
  try {
    const d = await api.get(`/api/conversations/${c.user_id}`)
    selUser.value = d.user; msgs.value = d.messages
    await nextTick()
    if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
  } finally { loadingMsgs.value = false }
}
async function blockUser() {
  const reason = prompt('封禁原因（可留空）：') ?? ''
  await api.put(`/api/users/${selUser.value.user_id}/block`, { reason, permanent:true })
  selUser.value.is_blocked = true
  updateConv(selUser.value.user_id, { is_blocked:true })
}
async function unblockUser() {
  await api.put(`/api/users/${selUser.value.user_id}/unblock`, {})
  selUser.value.is_blocked = false
  updateConv(selUser.value.user_id, { is_blocked:false })
}
function updateConv(uid, patch) {
  const i = convs.value.findIndex(c=>c.user_id===uid)
  if (i>=0) Object.assign(convs.value[i], patch)
}
function fmtShort(ts) {
  if (!ts) return ''
  const d=new Date(ts), diff=Date.now()-d
  if (diff<60000) return '刚刚'
  if (diff<3600000) return Math.floor(diff/60000)+'m'
  if (diff<86400000) return Math.floor(diff/3600000)+'h'
  return d.toLocaleDateString('zh-CN')
}
function fmtFull(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
}
function typeLabel(t) { return {photo:'图片',video:'视频',audio:'音频',voice:'语音',document:'文件',sticker:'贴纸'}[t]||t }

onMounted(async () => {
  await loadConvs()
  if (route.query.user) {
    const c = convs.value.find(x=>String(x.user_id)===String(route.query.user))
    if (c) selectUser(c)
  }
})
</script>
<style scoped>
.conv-page{display:flex;height:calc(100vh - 48px);margin:-24px;overflow:hidden}
.conv-left{width:280px;min-width:280px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg2)}
.left-search{padding:12px;border-bottom:1px solid var(--border)}
.left-search input{font-size:13px}
.left-list{flex:1;overflow-y:auto}
.left-item{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;transition:var(--tr);border-bottom:1px solid var(--border)}
.left-item:hover{background:var(--bg3)}.left-item.active{background:var(--accent-dim)}
.item-ava{width:38px;height:38px;border-radius:50%;flex-shrink:0;background:var(--bg3);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.item-ava.blocked{background:rgba(247,79,79,.15);color:var(--danger)}
.item-body{flex:1;min-width:0}
.item-name{font-size:13px;font-weight:500;display:flex;align-items:center}
.item-preview{font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.item-time{font-size:11px;color:var(--text3);flex-shrink:0}
.conv-right{flex:1;display:flex;flex-direction:column;min-width:0}
.right-header{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--bg2);flex-shrink:0}
.hdr-info{display:flex;align-items:center;gap:12px}
.hdr-ava{width:40px;height:40px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px}
.hdr-name{font-weight:600;font-size:14px}
.hdr-actions{display:flex;align-items:center;gap:8px}
.msg-list{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:8px}
.msg-wrap{display:flex}
.msg-wrap.incoming{justify-content:flex-start}
.msg-wrap.outgoing{justify-content:flex-end}
.msg-bubble{max-width:70%;padding:10px 14px;border-radius:14px;font-size:13px}
.incoming .msg-bubble{background:var(--bg3);border-bottom-left-radius:4px}
.outgoing .msg-bubble{background:var(--accent-dim);border:1px solid rgba(79,142,247,.25);border-bottom-right-radius:4px}
.msg-text{word-break:break-word;white-space:pre-wrap}
.msg-meta{font-size:10px;color:var(--text3);margin-top:4px}
.conv-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text3);font-size:15px}
.empty{text-align:center;color:var(--text3);font-size:13px;padding:30px}
@media(max-width:768px){.conv-page{margin:-16px}.conv-left{width:100%}.conv-right{display:none}}
</style>