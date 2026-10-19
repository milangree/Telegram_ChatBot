<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title page-title-with-icon">
        <AppIcon
          name="dashboard"
          :size="20"
        />
        {{ t('dashboard.title') }}
      </h2>
      <button
        class="btn-ghost btn-sm"
        @click="load(true)"
      >
        <AppIcon
          name="refresh"
          :size="14"
        />
        {{ t('dashboard.refresh') }}
      </button>
    </div>

    <div
      v-if="loading"
      class="skeleton-stack mt-2"
    >
      <div class="stat-grid mb-2">
        <div
          v-for="i in 4"
          :key="i"
          class="card skeleton-card"
        >
          <div class="skeleton-row">
            <div class="skeleton skeleton-ava" />
            <div
              class="skeleton-stack"
              style="flex:1"
            >
              <div class="skeleton skeleton-line lg" />
              <div class="skeleton skeleton-line sm" />
            </div>
          </div>
        </div>
      </div>
      <div class="card skeleton-card">
        <div class="skeleton skeleton-line lg mb-2" />
        <div class="skeleton skeleton-line mb-1" />
        <div class="skeleton skeleton-line sm" />
      </div>
    </div>
    <template v-else>
      <div class="stat-grid mb-2">
        <div
          v-for="s in statCards"
          :key="s.label"
          class="stat-card card clickable"
          @click="goTo(s.to)"
        >
          <div class="stat-icon-wrap">
            <AppIcon
              :name="s.icon"
              :size="22"
            />
          </div>
          <div>
            <div
              class="stat-val"
              :class="s.cls"
            >
              {{ s.val }}
            </div>
            <div class="text-muted text-sm">
              {{ s.label }}
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-2">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon
            name="bot"
            :size="18"
          />
          {{ t('dashboard.botStatus') }}
        </h3>
        <div
          v-if="bot"
          class="bot-info"
        >
          <div class="bot-ava">
            <AppIcon
              name="bot"
              :size="28"
            />
          </div>
          <div>
            <div style="font-weight:600">
              {{ bot.first_name }}
            </div>
            <div class="text-muted text-sm">
              <template v-if="bot.username">
                <button
                  type="button"
                  class="id-copy"
                  :title="t('common.copy')"
                  @click="copyUsername(bot.username)"
                >
                  @{{ bot.username }}
                </button>
                <span> · </span>
              </template>
              <span class="id-inline">
                <span class="id-label">ID: </span>
                <button
                  type="button"
                  class="id-copy"
                  :title="t('common.copy')"
                  @click="copyTelegramId(bot.id)"
                >{{ bot.id }}</button>
              </span>
            </div>
          </div>
          <span class="badge badge-success">{{ t('dashboard.botOnline') }}</span>
        </div>
        <div
          v-else
          class="alert alert-error mb-1"
        >
          {{ t('dashboard.botTokenMissing') }} <RouterLink to="/settings">
            {{ t('nav.settings') }}
          </RouterLink>
        </div>
        <div class="config-checks mt-2">
          <div
            v-for="c in configChecks"
            :key="c.label"
            class="config-row"
          >
            <span
              class="text-muted"
              style="font-size:13px"
            >{{ c.label }}</span>
            <span
              class="badge"
              :class="c.ok ? 'badge-success' : 'badge-danger'"
            >
              {{ c.ok ? t('dashboard.config.ok') : t('dashboard.config.missing') }}
            </span>
          </div>
        </div>
      </div>

      <div class="card">
        <div
          class="flex"
          style="justify-content:space-between;align-items:center;margin-bottom:12px"
        >
          <h3
            class="sec-title sec-title-with-icon"
            style="margin:0"
          >
            <AppIcon
              name="conversations"
              :size="18"
            />
            {{ t('dashboard.recentConversations') }}
          </h3>
          <RouterLink
            to="/conversations"
            class="text-sm"
          >
            {{ t('dashboard.viewAll') }} →
          </RouterLink>
        </div>
        <div
          v-if="!convs.length"
          class="empty-state"
        >
          <div class="empty-state-icon">
            <AppIcon
              name="conversations"
              :size="24"
            />
          </div>
          <div class="empty-state-title">
            {{ t('dashboard.emptyConversations') }}
          </div>
        </div>
        <RouterLink
          v-for="c in convs.slice(0, 8)"
          :key="c.user_id"
          :to="`/conversations?user=${c.user_id}`"
          class="conv-row"
        >
          <div class="conv-ava">
            <img
              v-if="avatars[c.user_id]"
              :src="avatars[c.user_id]"
              class="ava-img"
              @error="avatars[c.user_id] = ''"
            >
            <span v-else>{{ (c.first_name || c.username || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="conv-body">
            <div class="conv-name">
              {{ c.first_name || c.username || c.user_id }}
              <span
                v-if="c.is_blocked"
                class="badge badge-danger"
                style="font-size:9px;margin-left:4px"
              >{{ t('dashboard.blockedShort') }}</span>
            </div>
            <div class="conv-preview text-muted">
              {{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || t('dashboard.noMessage') }}
            </div>
          </div>
          <div class="text-sm text-muted">
            {{ fmtTime(c.last_at) }}
          </div>
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'
import { useToast } from '../stores/toast.js'
import { getLatestTimestamp, mergeByKey, readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const router = useRouter()
const i18n = useI18nStore()
const t = i18n.t
const toast = useToast()

const stats = ref({}), convs = ref([]), settings = ref({}), bot = ref(null)
const loading = ref(true), avatars = ref({})

const DASHBOARD_STATS_CACHE_KEY = 'dashboard:stats'
const DASHBOARD_SETTINGS_CACHE_KEY = 'dashboard:settings'
const DASHBOARD_BOT_CACHE_KEY = 'dashboard:bot'
const DASHBOARD_CONVS_CACHE_KEY = 'conversations:list'

const statCards = computed(() => [
  { icon: 'users', label: t('dashboard.totalUsers'), val: stats.value.totalUsers ?? '—', cls: '', to: '/users' },
  { icon: 'block', label: t('dashboard.blockedUsers'), val: stats.value.blockedUsers ?? '—', cls: 'text-danger', to: '/users?filter=blocked' },
  { icon: 'conversations', label: t('dashboard.totalMessages'), val: stats.value.totalMessages ?? '—', cls: '', to: '/conversations' },
  { icon: 'today', label: t('dashboard.todayMessages'), val: stats.value.todayMessages ?? '—', cls: 'text-success', to: '/conversations' },
])

/** 脱敏值（**** / ****xxxx）或非空明文均视为已配置 */
function isConfigured(value) {
  return String(value ?? '').trim() !== ''
}

const configChecks = computed(() => [
  // GET /settings 对 BOT_TOKEN 脱敏为 ****xxxx；本地缓存仅保留 **** 占位
  { label: t('dashboard.config.botToken'), ok: isConfigured(settings.value.BOT_TOKEN) },
  { label: t('dashboard.config.topicGroupId'), ok: isConfigured(settings.value.FORUM_GROUP_ID) },
  { label: t('dashboard.config.adminIds'), ok: isConfigured(settings.value.ADMIN_IDS) },
])

function tryLoadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${uid}/avatar`
}

async function load(force = false) {
  loading.value = true

  const cachedStats = readLocalCache(DASHBOARD_STATS_CACHE_KEY, { ttlMs: 60 * 1000 })
  let cachedSettings = readLocalCache(DASHBOARD_SETTINGS_CACHE_KEY, { ttlMs: 5 * 60 * 1000 })
  // 旧缓存曾直接删除 BOT_TOKEN 字段，命中后会误判「未配置」——强制回源
  if (cachedSettings && typeof cachedSettings === 'object' && !('BOT_TOKEN' in cachedSettings)) {
    cachedSettings = null
  }
  const cachedBot = readLocalCache(DASHBOARD_BOT_CACHE_KEY, { ttlMs: 5 * 60 * 1000 })
  const cachedConvs = readLocalCache(DASHBOARD_CONVS_CACHE_KEY)

  if (cachedStats) stats.value = cachedStats
  if (cachedSettings) settings.value = cachedSettings
  if (cachedBot !== null) bot.value = cachedBot
  if (Array.isArray(cachedConvs) && cachedConvs.length) {
    convs.value = cachedConvs
    for (const c of cachedConvs) tryLoadAvatar(c.user_id)
    loading.value = false
  }

  try {
    const since = !force ? getLatestTimestamp(convs.value, 'last_at') : ''
    const [st, cv, se, botInfo] = await Promise.all([
      !force && cachedStats ? Promise.resolve(cachedStats) : api.get('/api/stats'),
      api.get(`/api/conversations${since ? `?since=${encodeURIComponent(since)}` : ''}`),
      !force && cachedSettings ? Promise.resolve(cachedSettings) : api.get('/api/settings'),
      !force && cachedBot !== null ? Promise.resolve(cachedBot) : api.get('/api/tg/me').then(r => r.bot).catch(() => null),
    ])

    stats.value = st
    convs.value = since
      ? mergeByKey(convs.value, Array.isArray(cv?.items) ? cv.items : [], 'user_id', (a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0))
      : (Array.isArray(cv?.items) ? cv.items : [])
    settings.value = se
    bot.value = botInfo

    writeLocalCache(DASHBOARD_STATS_CACHE_KEY, st)
    writeLocalCache(DASHBOARD_CONVS_CACHE_KEY, convs.value)
    writeLocalCache(DASHBOARD_SETTINGS_CACHE_KEY, se)
    writeLocalCache(DASHBOARD_BOT_CACHE_KEY, bot.value)

    for (const c of convs.value) tryLoadAvatar(c.user_id)
  } catch (err) {
    console.warn('[Dashboard] 数据加载失败:', err)
  } finally { loading.value = false }
}

function goTo(path) {
  if (path) router.push(path)
}

async function copyTelegramId(id) {
  const val = String(id ?? '').trim()
  if (!val) return
  try {
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(val)
    else {
      const ta = document.createElement('textarea')
      ta.value = val
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    toast.success(t('users.flash.copySuccess', { label: 'ID' }))
  } catch (e) {
    toast.error(t('users.flash.copyFailed', { err: e?.message || e }))
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
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    toast.success(t('users.flash.copySuccess', { label: t('users.copyUsername') }))
  } catch (e) {
    toast.error(t('users.flash.copyFailed', { err: e?.message || e }))
  }
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
.page-title-with-icon,
.sec-title-with-icon{display:flex;align-items:center;gap:8px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat-card{display:flex;align-items:center;gap:14px;transition:var(--tr);position:relative;overflow:hidden}
.stat-card.clickable{cursor:pointer;user-select:none}
.stat-card.clickable:hover{
  border-color:var(--accent);
  transform:translateY(-2px);
  box-shadow:0 8px 24px rgba(79,142,247,.15);
}
.stat-card.clickable:hover .stat-icon-wrap{transform:scale(1.08)}
.stat-val{font-size:26px;font-weight:700;line-height:1;letter-spacing:-.02em}
.text-danger{color:var(--danger)}.text-success{color:var(--success)}
.bot-info{display:flex;align-items:center;gap:12px}
.bot-ava{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--accent-dim);color:var(--accent)}
.config-checks{display:flex;flex-direction:column;gap:8px}
.config-row{display:flex;align-items:center;justify-content:space-between}
.conv-row{display:flex;align-items:center;gap:12px;padding:9px;border-radius:var(--rs);text-decoration:none;color:inherit;transition:var(--tr)}
.conv-row:hover{background:var(--bg3);padding-left:14px}
.conv-ava{width:36px;height:36px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;overflow:hidden}
.ava-img{width:100%;height:100%;object-fit:cover}
.conv-body{flex:1;min-width:0}
.conv-name{font-size:13px;font-weight:500;display:flex;align-items:center;gap:4px}
.conv-preview{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
</style>
