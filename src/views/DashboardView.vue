<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">📊 {{ t('dashboard.title') }}</h2>
      <button class="btn-ghost btn-sm" @click="load">🔄 {{ t('dashboard.refresh') }}</button>
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
        <h3 class="sec-title">🤖 {{ t('dashboard.botStatus') }}</h3>
        <div v-if="bot" class="bot-info">
          <div class="bot-ava">🤖</div>
          <div>
            <div style="font-weight:600">{{ bot.first_name }}</div>
            <div class="text-muted text-sm">@{{ bot.username }} · ID: {{ bot.id }}</div>
          </div>
          <span class="badge badge-success">✓ {{ t('dashboard.botOnline') }}</span>
        </div>
        <div v-else class="alert alert-error mb-1">
          {{ t('dashboard.botTokenMissing') }} <RouterLink to="/settings">{{ t('nav.settings') }}</RouterLink>
        </div>
        <div class="config-checks mt-2">
          <div class="config-row" v-for="c in configChecks" :key="c.label">
            <span class="text-muted" style="font-size:13px">{{ c.label }}</span>
            <span class="badge" :class="c.ok ? 'badge-success' : 'badge-danger'">
              {{ c.ok ? t('dashboard.config.ok') : t('dashboard.config.missing') }}
            </span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 class="sec-title" style="margin:0">💬 {{ t('dashboard.recentConversations') }}</h3>
          <RouterLink to="/conversations" class="text-sm">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <div v-if="!convs.length" class="text-muted text-sm text-center" style="padding:16px">{{ t('dashboard.emptyConversations') }}</div>
        <RouterLink v-for="c in convs.slice(0, 8)" :key="c.user_id" :to="`/conversations?user=${c.user_id}`" class="conv-row">
          <div class="conv-ava">
            <img v-if="avatars[c.user_id]" :src="avatars[c.user_id]" class="ava-img" @error="avatars[c.user_id] = ''" />
            <span v-else>{{ (c.first_name || c.username || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="conv-body">
            <div class="conv-name">
              {{ c.first_name || c.username || c.user_id }}
              <span v-if="c.is_blocked" class="badge badge-danger" style="font-size:9px;margin-left:4px">{{ t('dashboard.blockedShort') }}</span>
            </div>
            <div class="conv-preview text-muted">{{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || t('dashboard.noMessage') }}</div>
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
import { useI18nStore } from '../stores/i18n'

const router = useRouter()
const i18n = useI18nStore()
const t = i18n.t

const stats = ref({}), convs = ref([]), settings = ref({}), bot = ref(null)
const loading = ref(true), avatars = ref({})

const statCards = computed(() => [
  { icon: '👥', label: t('dashboard.totalUsers'), val: stats.value.totalUsers ?? '—', cls: '', to: '/users' },
  { icon: '⛔', label: t('dashboard.blockedUsers'), val: stats.value.blockedUsers ?? '—', cls: 'text-danger', to: '/users?filter=blocked' },
  { icon: '💬', label: t('dashboard.totalMessages'), val: stats.value.totalMessages ?? '—', cls: '', to: '/conversations' },
  { icon: '📅', label: t('dashboard.todayMessages'), val: stats.value.todayMessages ?? '—', cls: 'text-success', to: '/conversations' },
])

const configChecks = computed(() => [
  { label: t('dashboard.config.botToken'), ok: !!settings.value.BOT_TOKEN },
  { label: t('dashboard.config.topicGroupId'), ok: !!settings.value.FORUM_GROUP_ID },
  { label: t('dashboard.config.adminIds'), ok: !!settings.value.ADMIN_IDS },
])

function tryLoadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
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
  if (diff < 60000) return t('dashboard.justNow')
  if (diff < 3600000) return t('dashboard.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('dashboard.hoursAgo', { n: Math.floor(diff / 3600000) })
  const d = new Date(new Date(ts).getTime() + 8 * 3600000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCMonth() + 1}-${pad(d.getUTCDate())}`
}

onMounted(load)
</script>

<style scoped>
.page{max-width:720px;margin:0 auto}
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
