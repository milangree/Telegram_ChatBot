<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">📊 仪表盘</h2>
      <button class="btn-ghost btn-sm" @click="load">🔄 刷新</button>
    </div>

    <div v-if="loading" class="flex-center mt-3"><div class="spinner"></div></div>
    <template v-else>
      <div class="stat-grid mb-2">
        <div class="stat-card card clickable" v-for="s in statCards" :key="s.label" @click="goTo(s.to)">
          <div class="stat-icon">{{ s.icon }}</div>
          <div>
            <div class="stat-val" :class="s.cls">{{ s.val }}</div>
            <div class="text-muted text-sm">{{ s.label }}</div>
          </div>
        </div>
      </div>

      <div class="card mb-2">
        <h3 class="sec-title">🤖 Bot 状态</h3>
        <div v-if="bot" class="bot-info">
          <div class="bot-ava">🤖</div>
          <div>
            <div style="font-weight:600">{{ bot.first_name }}</div>
            <div class="text-muted text-sm">@{{ bot.username }} · ID: {{ bot.id }}</div>
          </div>
          <span class="badge badge-success">✓ 在线</span>
        </div>
        <div v-else class="alert alert-error mb-1">
          Bot Token 未配置 → <RouterLink to="/settings">前往设置</RouterLink>
        </div>
        <div class="config-checks mt-2">
          <div class="config-row" v-for="c in configChecks" :key="c.label">
            <span class="text-muted" style="font-size:13px">{{ c.label }}</span>
            <span class="badge" :class="c.ok ? 'badge-success' : 'badge-danger'">{{ c.ok ? '✓ 已配置' : '✗ 未配置' }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 class="sec-title" style="margin:0">💬 最近对话</h3>
          <RouterLink to="/conversations" class="text-sm">查看全部 →</RouterLink>
        </div>
        <div v-if="!convs.length" class="text-muted text-sm text-center" style="padding:16px">暂无对话</div>
        <RouterLink v-for="c in convs.slice(0, 8)" :key="c.user_id" :to="`/conversations?user=${c.user_id}`" class="conv-row">
          <div class="conv-ava">
            <img v-if="avatars[c.user_id]" :src="avatars[c.user_id]" class="ava-img" @error="avatars[c.user_id] = ''" />
            <span v-else>{{ (c.first_name || c.username || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="conv-body">
            <div class="conv-name">
              {{ c.first_name || c.username || c.user_id }}
              <span v-if="c.is_blocked" class="badge badge-danger" style="font-size:9px;margin-left:4px">封</span>
            </div>
            <div class="conv-preview text-muted">{{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || '无消息' }}</div>
          </div>
          <div class="text-sm text-muted">{{ fmtTime(c.last_at) }}</div>
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import api from '../stores/api.js'

const router = useRouter()
const stats = ref({}), convs = ref([]), settings = ref({}), bot = ref(null)
const loading = ref(true), avatars = ref({})

const statCards = computed(() => [
  { icon: '👥', label: '总用户数',   val: stats.value.totalUsers    ?? '—', cls: '', to: '/users' },
  { icon: '⛔', label: '封禁用户',   val: stats.value.blockedUsers  ?? '—', cls: 'text-danger', to: '/users?filter=blocked' },
  { icon: '💬', label: '总消息数',   val: stats.value.totalMessages ?? '—', cls: '', to: '/conversations' },
  { icon: '📅', label: '今日消息',   val: stats.value.todayMessages ?? '—', cls: 'text-success', to: '/conversations' },
])

const configChecks = computed(() => [
  { label: 'Bot Token',    ok: !!settings.value.BOT_TOKEN },
  { label: '论坛群组 ID', ok: !!settings.value.FORUM_GROUP_ID },
  { label: '管理员 ID',  ok: !!settings.value.ADMIN_IDS },
])

function tryLoadAvatar(uid) {
  const img = new Image()
  img.onload  = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${uid}/avatar`
}

async function load() {
  loading.value = true
  try {
    const [st, cv, se] = await Promise.all([
      api.get('/api/stats'),
      api.get('/api/conversations'),
      api.get('/api/settings'),
    ])
    stats.value = st; convs.value = cv; settings.value = se
    bot.value = await api.get('/api/tg/me').then(r => r.bot).catch(() => null)
    for (const c of cv) tryLoadAvatar(c.user_id)
  } finally { loading.value = false }
}

function goTo(path) {
  if (path) router.push(path)
}

function fmtTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts)
  if (diff < 60000)    return '刚刚'
  if (diff < 3600000)  return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  // Show UTC+8 date
  const d = new Date(new Date(ts).getTime() + 8 * 3600000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCMonth()+1}-${pad(d.getUTCDate())}`
}

onMounted(load)
</script>

<style scoped>
.page{max-width:900px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat-card{display:flex;align-items:center;gap:14px}
.stat-card.clickable{cursor:pointer;user-select:none}
.stat-card.clickable:hover{border-color:var(--accent);transform:translateY(-1px)}
.stat-icon{font-size:28px}
.stat-val{font-size:26px;font-weight:700;line-height:1}
.text-danger{color:var(--danger)}.text-success{color:var(--success)}
.bot-info{display:flex;align-items:center;gap:12px}
.bot-ava{font-size:32px}
.config-checks{display:flex;flex-direction:column;gap:8px}
.config-row{display:flex;align-items:center;justify-content:space-between}
.conv-row{display:flex;align-items:center;gap:12px;padding:9px;border-radius:var(--rs);text-decoration:none;color:inherit;transition:var(--tr)}
.conv-row:hover{background:var(--bg3)}
.conv-ava{width:36px;height:36px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;overflow:hidden}
.ava-img{width:100%;height:100%;object-fit:cover}
.conv-body{flex:1;min-width:0}
.conv-name{font-size:13px;font-weight:500;display:flex;align-items:center;gap:4px}
.conv-preview{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
</style>
