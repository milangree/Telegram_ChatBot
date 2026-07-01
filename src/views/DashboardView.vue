<template>
  <v-container class="py-6" style="max-width:800px">
    <!-- 标题栏 -->
    <div class="d-flex align-center justify-space-between mb-5">
      <h2 class="text-h5 font-weight-bold d-flex align-center ga-2">
        <v-icon :icon="mdiViewDashboardOutline" size="28" />
        {{ t('dashboard.title') }}
      </h2>
      <v-btn variant="text" size="small" :loading="loading" @click="load(true)">
        <v-icon :icon="mdiRefresh" size="18" class="mr-1" />
        {{ t('dashboard.refresh') }}
      </v-btn>
    </div>

    <v-progress-linear v-if="loading && !stats.totalUsers" indeterminate color="primary" class="mb-4" />

    <template v-else>
      <!-- 统计卡片 -->
      <v-row class="mb-4">
        <v-col v-for="s in statCards" :key="s.label" cols="6" md="3">
          <v-card :color="s.color" variant="tonal" class="pa-4 cursor-pointer" hover @click="goTo(s.to)">
            <div class="d-flex align-center ga-3">
              <v-icon :icon="s.icon" size="32" />
              <div>
                <div class="text-h5 font-weight-bold">{{ s.val }}</div>
                <div class="text-caption text-medium-emphasis">{{ s.label }}</div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- 机器人状态 -->
      <v-card class="mb-4 pa-4">
        <h3 class="text-subtitle-1 font-weight-bold d-flex align-center ga-2 mb-3">
          <v-icon :icon="mdiRobotOutline" size="20" />
          {{ t('dashboard.botStatus') }}
        </h3>

        <div v-if="bot" class="d-flex align-center ga-3">
          <v-avatar color="primary" size="44" rounded="lg">
            <v-icon :icon="mdiRobotOutline" size="24" />
          </v-avatar>
          <div>
            <div class="font-weight-medium">{{ bot.first_name }}</div>
            <div class="text-caption text-medium-emphasis">@{{ bot.username }} · ID: {{ bot.id }}</div>
          </div>
          <v-chip color="success" size="small" variant="tonal" class="ml-auto">
            {{ t('dashboard.botOnline') }}
          </v-chip>
        </div>

        <v-alert v-else type="error" variant="tonal" class="mb-2">
          {{ t('dashboard.botTokenMissing') }}
          <RouterLink to="/settings" class="text-primary font-weight-medium">{{ t('nav.settings') }}</RouterLink>
        </v-alert>

        <v-divider class="my-3" />

        <div v-for="c in configChecks" :key="c.label" class="d-flex align-center justify-space-between py-1">
          <span class="text-caption text-medium-emphasis">{{ c.label }}</span>
          <v-chip :color="c.ok ? 'success' : 'error'" size="x-small" variant="tonal">
            {{ c.ok ? t('dashboard.config.ok') : t('dashboard.config.missing') }}
          </v-chip>
        </div>
      </v-card>

      <!-- 最近对话 -->
      <v-card class="pa-4">
        <div class="d-flex align-center justify-space-between mb-3">
          <h3 class="text-subtitle-1 font-weight-bold d-flex align-center ga-2" style="margin:0">
            <v-icon :icon="mdiMessageTextOutline" size="20" />
            {{ t('dashboard.recentConversations') }}
          </h3>
          <RouterLink to="/conversations" class="text-primary text-caption">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>

        <div v-if="!convs.length" class="text-center text-medium-emphasis py-4">
          {{ t('dashboard.emptyConversations') }}
        </div>

        <v-list v-else density="compact">
          <v-list-item
            v-for="c in convs.slice(0, 8)"
            :key="c.user_id"
            :to="`/conversations?user=${c.user_id}`"
            rounded="lg"
          >
            <template #prepend>
              <v-avatar color="primary" size="36" rounded="circle" class="mr-3">
                <v-img v-if="avatars[c.user_id]" :src="avatars[c.user_id]" cover />
                <span v-else class="text-white font-weight-bold text-caption">
                  {{ (c.first_name || c.username || '?')[0].toUpperCase() }}
                </span>
              </v-avatar>
            </template>
            <v-list-item-title class="d-flex align-center ga-1">
              {{ c.first_name || c.username || c.user_id }}
              <v-chip v-if="c.is_blocked" color="error" size="x-small" variant="tonal">
                {{ t('dashboard.blockedShort') }}
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>
              {{ c.last_direction === 'outgoing' ? '← ' : '→ ' }}{{ c.last_message || t('dashboard.noMessage') }}
            </v-list-item-subtitle>
            <template #append>
              <span class="text-caption text-medium-emphasis">{{ fmtTime(c.last_at) }}</span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { mdiAccountGroupOutline, mdiBlockHelper, mdiMessageTextOutline, mdiCalendarToday, mdiViewDashboardOutline, mdiRefresh, mdiRobotOutline } from '@mdi/js'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'
import { getLatestTimestamp, mergeByKey, readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const router = useRouter()
const i18n = useI18nStore()
const t = i18n.t

const stats = ref({})
const convs = ref([])
const settings = ref({})
const bot = ref(null)
const loading = ref(true)
const avatars = ref({})

const statCards = computed(() => [
  { icon: mdiAccountGroupOutline, label: t('dashboard.totalUsers'), val: stats.value.totalUsers ?? '—', color: 'primary', to: '/users' },
  { icon: mdiBlockHelper, label: t('dashboard.blockedUsers'), val: stats.value.blockedUsers ?? '—', color: 'error', to: '/users?filter=blocked' },
  { icon: mdiMessageTextOutline, label: t('dashboard.totalMessages'), val: stats.value.totalMessages ?? '—', color: 'info', to: '/conversations' },
  { icon: mdiCalendarToday, label: t('dashboard.todayMessages'), val: stats.value.todayMessages ?? '—', color: 'success', to: '/conversations' },
])

const configChecks = computed(() => [
  { label: t('dashboard.config.botToken'), ok: !!settings.value.BOT_TOKEN },
  { label: t('dashboard.config.topicGroupId'), ok: !!settings.value.FORUM_GROUP_ID },
  { label: t('dashboard.config.adminIds'), ok: !!settings.value.ADMIN_IDS },
])

function tryLoadAvatar(uid) {
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.src = `/api/users/${uid}/avatar`
}

async function load(force = false) {
  loading.value = true
  const cachedStats = readLocalCache('dashboard:stats', { ttlMs: 60000 })
  const cachedSettings = readLocalCache('dashboard:settings', { ttlMs: 300000 })
  const cachedBot = readLocalCache('dashboard:bot', { ttlMs: 300000 })
  const cachedConvs = readLocalCache('conversations:list')

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
    writeLocalCache('dashboard:stats', st)
    writeLocalCache('conversations:list', convs.value)
    writeLocalCache('dashboard:settings', se)
    writeLocalCache('dashboard:bot', bot.value)
    for (const c of convs.value) tryLoadAvatar(c.user_id)
  } finally { loading.value = false }
}

function goTo(path) { if (path) router.push(path) }

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
