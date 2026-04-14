<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title page-title-with-icon">
        <AppIcon name="settings" :size="20" />
        {{ t('settings.title') }}
      </h2>
      <div class="flex gap-2">
        <button class="btn-ghost btn-sm" @click="load(true)">
          <AppIcon name="refresh" :size="14" />
        </button>
        <button class="btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="spinner"></span>{{ saving ? t('settings.saving') : t('settings.save') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex-center mt-3"><div class="spinner"></div></div>
    <template v-else>
      <transition name="fade">
        <div v-if="saved" class="alert alert-success">{{ t('settings.saved') }}</div>
      </transition>
      <div v-if="saveErr" class="alert alert-error">{{ saveErr }}</div>

      <!-- Bot 配置 -->
      <div class="card section settings-card">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon name="bot" :size="18" />
          {{ t('settings.section.bot') }}
        </h3>
        <div class="form-group">
          <label>{{ t('settings.config.botToken') }} <span class="req">*</span></label>
          <div class="row-g settings-inline-row">
            <input v-model="form.BOT_TOKEN" type="password" :placeholder="t('settings.token.placeholder')" autocomplete="off" />
            <button class="btn-ghost btn-sm settings-inline-btn" @click="testToken" :disabled="testingTok">{{ testingTok ? '…' : t('settings.token.test') }}</button>
          </div>
          <div v-if="tokResult" class="form-hint" :class="tokResult.ok ? 'text-success' : 'text-danger'">
            {{ tokResult.ok ? t('settings.token.valid', { username: tokResult.bot.username, id: tokResult.bot.id }) : tokResult.err }}
          </div>
        </div>

        <div class="form-group">
          <label>{{ t('settings.topicGroupId') }} <span class="req">*</span></label>
          <div class="row-g settings-inline-row">
            <input v-model="form.FORUM_GROUP_ID" :placeholder="t('settings.topicGroupPh')" />
            <button class="btn-ghost btn-sm utility-btn settings-inline-btn" @click="resolveChat(form.FORUM_GROUP_ID, 'group')" :disabled="resolvingGroup">
              {{ resolvingGroup ? '…' : t('settings.resolve') }}
            </button>
          </div>
          <div v-if="groupInfo" class="resolve-card">
            <AppIcon :name="groupInfo.type === 'supergroup' ? 'users' : 'conversations'" :size="18" />
            <div>
              <div style="font-weight:600">{{ groupInfo.title }}</div>
              <div class="text-muted text-sm">{{ t('common.id') }}: <code>{{ groupInfo.id }}</code></div>
            </div>
            <button class="btn-primary btn-sm utility-btn" @click="form.FORUM_GROUP_ID = String(groupInfo.id)">{{ t('settings.use') }}</button>
          </div>
          <div v-if="groupErr" class="form-hint text-danger">{{ groupErr }}</div>
        </div>

        <div class="form-group">
          <label>{{ t('settings.queryChat') }}</label>
          <div class="row-g settings-inline-row">
            <input v-model="chatQuery" :placeholder="t('settings.queryPh')" />
            <button class="btn-ghost btn-sm utility-btn settings-inline-btn" @click="resolveChat(chatQuery, 'custom')" :disabled="resolvingCustom">{{ resolvingCustom ? '…' : t('settings.query') }}</button>
          </div>
          <div v-if="customInfo" class="resolve-card">
            <AppIcon :name="{ supergroup: 'users', channel: 'link' }[customInfo.type] || 'conversations'" :size="18" />
            <div style="flex:1">
              <div>{{ customInfo.title || customInfo.first_name }}</div>
              <div class="text-muted text-sm">{{ t('common.id') }}: {{ customInfo.id }}</div>
            </div>
            <button class="btn-ghost btn-sm utility-btn" @click="form.FORUM_GROUP_ID = String(customInfo.id)">{{ t('settings.useId') }}</button>
            <button class="btn-ghost btn-sm utility-btn" @click="addAdmin(String(customInfo.id))">{{ t('settings.setAdmin') }}</button>
          </div>
        </div>

        <div class="form-group">
          <label>{{ t('settings.adminIds') }}</label>
          <div v-if="adminList.length" class="admin-tags" :class="{ 'admin-tags-single': adminList.length === 1 }">
            <div v-for="(id, i) in adminList" :key="id" class="admin-card">
              <div class="admin-card-avatar">
                <img
                  v-if="!adminAvatarErrors[id]"
                  :src="`/api/users/${id}/avatar`"
                  alt=""
                  class="admin-card-avatar-img"
                  @error="markAdminAvatarError(id)"
                />
                <span v-else>{{ adminInitial(id) }}</span>
              </div>
              <div class="admin-card-info">
                <div class="admin-card-name">{{ adminDisplayName(id) }}</div>
                <div class="admin-card-meta">{{ adminSecondaryLine(id) }}</div>
                <div class="admin-card-id">{{ t('common.id') }}: {{ id }}</div>
              </div>
              <button class="btn-ghost btn-sm admin-card-remove" @click="removeAdmin(i)">
                <AppIcon name="close" :size="14" />
              </button>
            </div>
          </div>
          <div class="row-g">
            <UserSearchPicker v-model="newAdminId" @selected="u => newAdminId = String(u.user_id)" />
            <button class="btn-ghost btn-sm utility-btn" @click="addAdmin(newAdminId)">{{ t('settings.add') }}</button>
          </div>
          <div class="form-hint">{{ t('settings.adminHint') }}</div>
        </div>
      </div>

      <!-- Webhook -->
      <div class="card section settings-card">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon name="webhook" :size="18" />
          {{ t('settings.section.webhook') }}
        </h3>
        <div class="form-group">
          <label>{{ t('settings.webhookUrl') }}</label>
          <div class="row-g">
            <input v-model="webhookUrl" :placeholder="t('settings.webhook.placeholder')" />
            <button class="btn-primary btn-sm" @click="setWebhook" :disabled="settingWh">{{ settingWh ? '…' : t('settings.webhookSet') }}</button>
          </div>
          <div v-if="whResult" class="form-hint" :class="whResult.ok ? 'text-success' : 'text-danger'">
            {{ whResult.ok ? whResult.message : whResult.err }}
          </div>
          <div class="form-hint">{{ t('settings.webhookHint') }}</div>
        </div>
      </div>

      <!-- 验证配置 -->
      <div class="card section settings-card">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon name="verify" :size="18" />
          {{ t('settings.section.verify') }}
        </h3>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.verifyEnable') }}</div>
            <div class="form-hint">{{ t('settings.verifyEnableHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="verifyEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <template v-if="verifyEnabled">
          <div class="divider"></div>
          <div class="form-group">
            <label>{{ t('settings.verifyType') }}</label>
            <select v-model="form.CAPTCHA_TYPE">
              <option value="math">{{ t('settings.verify.math') }}</option>
              <option value="image_numeric">{{ t('settings.verify.imgNum') }}</option>
              <option value="image_alphanumeric">{{ t('settings.verify.imgAlpha') }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('settings.verify.siteUrl') }}</label>
            <input v-model="form.CAPTCHA_SITE_URL" :placeholder="t('settings.verify.siteUrlPh')" />
            <div class="form-hint">{{ t('settings.verify.siteUrlHint') }}</div>
          </div>
          <div class="toggle-row">
            <div class="toggle-label">{{ t('settings.verify.timeout') }}</div>
            <input v-model.number="form.VERIFICATION_TIMEOUT" type="number" min="60" max="3600" style="width:90px" @change="clampTimeout" />
          </div>
          <div class="toggle-row">
            <div class="toggle-label">{{ t('settings.verify.maxAttempts') }}</div>
            <input v-model="form.MAX_VERIFICATION_ATTEMPTS" type="number" min="1" max="10" style="width:90px" />
          </div>
        </template>
      </div>

      <!-- 功能配置 -->
      <div class="card section settings-card">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon name="feature" :size="18" />
          {{ t('settings.section.feature') }}
        </h3>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.autoUnblock') }}</div>
            <div class="form-hint">{{ t('settings.feature.autoUnblockHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="autoUnblock" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.whitelist') }}</div>
            <div class="form-hint">{{ t('settings.feature.whitelistHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="whitelistEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.cmdFilter') }}</div>
            <div class="form-hint">{{ t('settings.feature.cmdFilterHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="cmdFilter" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.adminNotify') }}</div>
            <div class="form-hint">{{ t('settings.feature.adminNotifyHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="adminNotifyEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.zalgoFilter') }}</div>
            <div class="form-hint">{{ t('settings.feature.zalgoFilterHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="zalgoFilterEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div class="toggle-label">{{ t('settings.feature.maxPerMin') }}</div>
          <input v-model="form.MAX_MESSAGES_PER_MINUTE" type="number" min="1" max="300" style="width:90px" />
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.inlineKbDeleteEnable') }}</div>
            <div class="form-hint">{{ t('settings.feature.inlineKbDeleteEnableHint') }}</div>
          </div>
          <label class="toggle"><input type="checkbox" v-model="inlineKbDeleteEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <template v-if="inlineKbDeleteEnabled">
          <div class="divider"></div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">{{ t('settings.feature.inlineKbDelete') }}</div>
              <div class="form-hint">{{ t('settings.feature.inlineKbDeleteHint') }}</div>
            </div>
            <input v-model.number="form.INLINE_KB_MSG_DELETE_SECONDS" type="number" min="0" max="600" style="width:90px" @change="clampInlineKbDelete" />
          </div>
        </template>
      </div>

      <!-- 欢迎消息 -->
      <div class="card section settings-card">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon name="welcome" :size="18" />
          {{ t('settings.section.welcome') }}
        </h3>
        <div class="toggle-row">
          <div class="toggle-label">{{ t('settings.welcome.enable') }}</div>
          <label class="toggle"><input type="checkbox" v-model="welcomeEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="form-group mt-1" v-if="welcomeEnabled">
          <label>{{ t('settings.welcome.content') }}</label>
          <textarea v-model="form.WELCOME_MESSAGE" rows="5" style="resize:vertical;font-family:monospace;font-size:13px"></textarea>
        </div>
      </div>

      <!-- 数据库切换 -->
      <div class="card section settings-card">
        <h3 class="sec-title sec-title-with-icon">
          <AppIcon name="storage" :size="18" />
          {{ t('settings.section.storage') }}
        </h3>
        <div class="db-status">
          <div>
            <div class="toggle-label">
              {{ t('settings.storage.current') }}
              <span :class="dbInfo.active === 'd1' ? 'text-success' : 'text-warn'">{{ dbInfo.active === 'd1' ? t('settings.storage.currentD1') : t('settings.storage.currentKv') }}</span>
            </div>
            <div class="form-hint" v-if="!dbInfo.hasD1">{{ t('settings.storage.noD1') }}</div>
          </div>
          <div class="flex gap-2" v-if="dbInfo.hasD1">
            <button class="btn-ghost btn-sm" :class="{ 'btn-primary': dbInfo.active === 'kv' }" :disabled="dbSwitching || dbInfo.active === 'kv'" @click="switchDb('kv', true)">{{ t('settings.storage.kvShort') }}</button>
            <button class="btn-ghost btn-sm" :class="{ 'btn-primary': dbInfo.active === 'd1' }" :disabled="dbSwitching || dbInfo.active === 'd1'" @click="switchDb('d1', true)">{{ t('settings.storage.d1Short') }}</button>
          </div>
        </div>
        <div v-if="dbSwitching" class="flex gap-2 mt-1"><div class="spinner"></div><span class="text-muted text-sm">{{ t('settings.storage.syncing') }}</span></div>
        <div v-if="dbMsg" class="form-hint mt-1" :class="dbOk ? 'text-success' : 'text-danger'">{{ dbMsg }}</div>
        <div class="form-hint mt-1">{{ t('settings.storage.switchHint') }}</div>
        <div class="divider"></div>

        <div class="sql-tools">
          <div class="sql-tools-header">
            <div>
              <div class="toggle-label">{{ t('settings.storage.sqlTools') }}</div>
              <div class="form-hint mt-1">{{ t('settings.storage.sqlHint') }}</div>
            </div>
            <div class="sql-tools-actions">
              <button class="btn-ghost btn-sm" :disabled="sqlWorking" @click="exportSql">
                <span v-if="sqlWorking" class="spinner"></span>{{ sqlWorking ? '…' : t('settings.storage.sqlExport') }}
              </button>
              <button class="btn-primary btn-sm" :disabled="sqlWorking" @click="pickSqlFile">
                <span v-if="sqlWorking" class="spinner"></span>{{ sqlWorking ? '…' : t('settings.storage.sqlImport') }}
              </button>
              <input
                ref="sqlFileInput"
                type="file"
                accept=".sql,text/sql"
                class="sql-file-input"
                @change="handleSqlFileChange"
              />
            </div>
          </div>
          <div class="form-group mt-2 w-full">
            <textarea
              v-model="sqlText"
              rows="10"
              class="sql-textarea"
              :placeholder="t('settings.storage.sqlPlaceholder')"
              spellcheck="false"
            ></textarea>
          </div>
          <div v-if="sqlMsg" class="form-hint mt-1" :class="sqlOk ? 'text-success' : 'text-danger'">{{ sqlMsg }}</div>
        </div>

        <div class="divider"></div>
        <div class="danger-zone">
          <div>
            <div class="toggle-label text-danger">{{ t('settings.storage.clearData') }}</div>
            <div class="form-hint mt-1">{{ t('settings.storage.clearDataHint') }}</div>
          </div>
          <button class="btn-danger btn-sm" @click="clearData" :disabled="clearingData">
            <span v-if="clearingData" class="spinner"></span>{{ clearingData ? t('settings.storage.clearing') : t('settings.storage.clearData') }}
          </button>
        </div>
      </div>

      <div style="text-align:right;margin-top:12px">
        <button class="btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="spinner"></span>{{ saving ? t('settings.saving') : t('settings.saveAll') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'
import { useI18nStore } from '../stores/i18n'
import { useAuthStore } from '../stores/auth.js'
import { readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const i18n = useI18nStore()
const auth = useAuthStore()
const router = useRouter()
const t = i18n.t

const form = ref({})
const loading = ref(true), saving = ref(false), saved = ref(false), saveErr = ref('')
const testingTok = ref(false), tokResult = ref(null)
const webhookUrl = ref(''), settingWh = ref(false), whResult = ref(null)
const chatQuery = ref(''), resolvingCustom = ref(false), customInfo = ref(null)
const resolvingGroup = ref(false), groupInfo = ref(null), groupErr = ref('')
const newAdminId = ref('')
const adminProfiles = ref({})
const adminAvatarErrors = ref({})
const dbInfo = ref({ active: 'kv', hasD1: false }), dbSwitching = ref(false), dbMsg = ref(''), dbOk = ref(true)
const clearingData = ref(false)
const sqlText = ref(''), sqlWorking = ref(false), sqlMsg = ref(''), sqlOk = ref(true)
const sqlFileInput = ref(null)

const SETTINGS_CACHE_KEY = 'settings:form'
const SETTINGS_DB_CACHE_KEY = 'settings:db-info'

let adminProfileSeq = 0

function syncSettingsCache() {
  writeLocalCache(SETTINGS_CACHE_KEY, {
    ...form.value,
    WEBHOOK_URL: webhookUrl.value || '',
  })
}

const boolProp = key => computed({ get: () => form.value[key] === 'true', set: v => { form.value[key] = v ? 'true' : 'false' } })
const verifyEnabled = boolProp('VERIFICATION_ENABLED')
const autoUnblock = boolProp('AUTO_UNBLOCK_ENABLED')
const whitelistEnabled = boolProp('WHITELIST_ENABLED')
const cmdFilter = boolProp('BOT_COMMAND_FILTER')
const adminNotifyEnabled = boolProp('ADMIN_NOTIFY_ENABLED')
const zalgoFilterEnabled = boolProp('ZALGO_FILTER_ENABLED')
const inlineKbDeleteEnabled = boolProp('INLINE_KB_MSG_DELETE_ENABLED')
const welcomeEnabled = boolProp('WELCOME_ENABLED')

const adminList = computed({
  get: () => (form.value.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  set: arr => { form.value.ADMIN_IDS = arr.join(',') },
})
function addAdmin(id) { const v = String(id).trim(); if (v && !adminList.value.includes(v)) adminList.value = [...adminList.value, v]; newAdminId.value = '' }
function removeAdmin(i) { const a = [...adminList.value]; a.splice(i, 1); adminList.value = a }

function getAdminProfile(id) {
  return adminProfiles.value[String(id)] || { user_id: String(id), first_name: '', last_name: '', username: '' }
}

function adminDisplayName(id) {
  const profile = getAdminProfile(id)
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return fullName || (profile.username ? `@${profile.username}` : `ID ${id}`)
}

function adminSecondaryLine(id) {
  const profile = getAdminProfile(id)
  return profile.username ? `@${profile.username}` : t('users.detail.noUsername')
}

function adminInitial(id) {
  const profile = getAdminProfile(id)
  const seed = String(profile.first_name || profile.username || id || '?').replace(/^@/, '')
  return seed ? seed[0].toUpperCase() : '?'
}

function markAdminAvatarError(id) {
  adminAvatarErrors.value = { ...adminAvatarErrors.value, [String(id)]: true }
}

async function resolveAdminProfiles() {
  const ids = adminList.value.map((id) => String(id))
  const currentSeq = ++adminProfileSeq

  if (!ids.length) {
    adminProfiles.value = {}
    adminAvatarErrors.value = {}
    return
  }

  const nextProfiles = {}

  await Promise.all(ids.map(async (id) => {
    try {
      const matches = await api.get(`/api/users/search?q=${encodeURIComponent(id)}`)
      const exact = Array.isArray(matches) ? matches.find((item) => String(item.user_id) === id) : null
      if (exact) {
        nextProfiles[id] = exact
        return
      }
    } catch {}

    try {
      const result = await api.post('/api/tg/resolve-chat', { chatId: id })
      const chat = result?.chat
      if (chat) {
        nextProfiles[id] = {
          user_id: String(chat.id || id),
          first_name: chat.first_name || chat.title || '',
          last_name: chat.last_name || '',
          username: chat.username || '',
        }
        return
      }
    } catch {}

    nextProfiles[id] = { user_id: id, first_name: '', last_name: '', username: '' }
  }))

  if (currentSeq !== adminProfileSeq) return

  adminProfiles.value = nextProfiles
  adminAvatarErrors.value = ids.reduce((acc, id) => {
    acc[id] = false
    return acc
  }, {})
}

async function load(force = false) {
  loading.value = true

  const cachedSettings = !force ? readLocalCache(SETTINGS_CACHE_KEY, { ttlMs: 5 * 60 * 1000 }) : null
  const cachedDbInfo = !force ? readLocalCache(SETTINGS_DB_CACHE_KEY, { ttlMs: 5 * 60 * 1000 }) : null

  if (cachedSettings) {
    form.value = { ...cachedSettings }
    form.value.WEBHOOK_URL = cachedSettings.WEBHOOK_URL || ''
    form.value.CAPTCHA_SITE_URL = cachedSettings.CAPTCHA_SITE_URL || ''
    webhookUrl.value = cachedSettings.WEBHOOK_URL || ''
    loading.value = false
    resolveAdminProfiles()
  }
  if (cachedDbInfo) dbInfo.value = cachedDbInfo

  try {
    const [data, db] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/settings/db'),
    ])
    form.value = data
    dbInfo.value = db
    form.value.WEBHOOK_URL = data.WEBHOOK_URL || ''
    webhookUrl.value = data.WEBHOOK_URL || ''
    form.value.CAPTCHA_SITE_URL = data.CAPTCHA_SITE_URL || ''

    syncSettingsCache()
    writeLocalCache(SETTINGS_DB_CACHE_KEY, dbInfo.value)

    resolveAdminProfiles()
  } catch (e) {
    saveErr.value = t('settings.loadFailed', { err: e.message })
  } finally {
    loading.value = false
  }
}
function clampTimeout() {
  const v = parseInt(form.value.VERIFICATION_TIMEOUT, 10)
  if (isNaN(v) || v < 60) form.value.VERIFICATION_TIMEOUT = '60'
}

function clampInlineKbDelete() {
  const v = parseInt(form.value.INLINE_KB_MSG_DELETE_SECONDS, 10)
  if (isNaN(v) || v < 0) form.value.INLINE_KB_MSG_DELETE_SECONDS = '30'
  else if (v > 600) form.value.INLINE_KB_MSG_DELETE_SECONDS = '600'
  else form.value.INLINE_KB_MSG_DELETE_SECONDS = String(v)
}
async function save() {
  clampTimeout()
  clampInlineKbDelete()
  saving.value = true; saved.value = false; saveErr.value = ''
  try {
    form.value.WEBHOOK_URL = webhookUrl.value || ''
    await api.put('/api/settings', form.value)
    saved.value = true
    form.value.WEBHOOK_URL = webhookUrl.value || ''
    syncSettingsCache()
    setTimeout(() => saved.value = false, 3000)
  } catch (e) {
    saveErr.value = e.message
  } finally {
    saving.value = false
  }
}
async function testToken() {
  testingTok.value = true; tokResult.value = null
  try { tokResult.value = await api.post('/api/settings/test-token', { token: form.value.BOT_TOKEN }) }
  catch (e) { tokResult.value = { ok: false, err: e.message } }
  finally { testingTok.value = false }
}
async function resolveChat(val, which) {
  if (!val) return
  if (which === 'group') { resolvingGroup.value = true; groupInfo.value = null; groupErr.value = '' }
  else { resolvingCustom.value = true; customInfo.value = null }
  try {
    const d = await api.post('/api/tg/resolve-chat', { chatId: val })
    if (which === 'group') groupInfo.value = d.chat; else customInfo.value = d.chat
  } catch (e) { if (which === 'group') groupErr.value = e.message }
  finally { if (which === 'group') resolvingGroup.value = false; else resolvingCustom.value = false }
}
async function setWebhook() {
  settingWh.value = true; whResult.value = null
  try {
    whResult.value = await api.post('/api/settings/webhook', { webhookUrl: webhookUrl.value })
    form.value.WEBHOOK_URL = webhookUrl.value || ''
    if (!form.value.CAPTCHA_SITE_URL && webhookUrl.value) {
      form.value.CAPTCHA_SITE_URL = new URL(webhookUrl.value).origin
    }
    syncSettingsCache()
  }
  catch (e) { whResult.value = { ok: false, err: e.message } }
  finally { settingWh.value = false }
}
async function switchDb(target, sync = true) {
  dbSwitching.value = true; dbMsg.value = ''
  try {
    await api.post('/api/settings/db/switch', { target, sync })
    dbInfo.value.active = target
    writeLocalCache(SETTINGS_DB_CACHE_KEY, dbInfo.value)
    dbMsg.value = t('settings.storage.switched', { target: target === 'd1' ? t('settings.storage.d1Short') : t('settings.storage.kvShort') })
    dbOk.value = true
  } catch (e) {
    dbMsg.value = e.message
    dbOk.value = false
  } finally {
    dbSwitching.value = false
  }
}

function buildSqlFileName(active) {
  const kind = String(active || dbInfo.value.active || 'kv').toUpperCase()
  return `${kind}.sql`
}

function downloadSqlFile(content, fileName) {
  const blob = new Blob([content], { type: 'text/sql;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function pickSqlFile() {
  if (sqlWorking.value) return
  sqlFileInput.value?.click()
}

async function exportSql() {
  if (sqlWorking.value) return
  sqlWorking.value = true
  sqlMsg.value = ''

  try {
    const result = await api.get('/api/settings/sql/export')
    const sql = result?.sql || ''
    const fileName = buildSqlFileName(result?.active)
    sqlText.value = sql
    downloadSqlFile(sql, fileName)
    sqlMsg.value = t('settings.storage.sqlExported', { name: fileName })
    sqlOk.value = true
  } catch (e) {
    sqlMsg.value = e.message
    sqlOk.value = false
  } finally {
    sqlWorking.value = false
  }
}

async function importSql(fileName = 'SQL') {
  if (sqlWorking.value) return
  if (!sqlText.value.trim()) {
    sqlMsg.value = t('settings.storage.sqlEmpty')
    sqlOk.value = false
    return
  }
  if (!confirm(t('settings.storage.sqlImportConfirm'))) return

  sqlWorking.value = true
  sqlMsg.value = ''

  try {
    await api.post('/api/settings/sql/import', { sql: sqlText.value }, { timeout: 5 * 60 * 1000 })
    await load(true)
    sqlMsg.value = t('settings.storage.sqlImported', { name: fileName })
    sqlOk.value = true
  } catch (e) {
    sqlMsg.value = e.message
    sqlOk.value = false
  } finally {
    sqlWorking.value = false
  }
}

async function handleSqlFileChange(event) {
  const file = event?.target?.files?.[0]
  if (!file) return

  try {
    sqlText.value = await file.text()
    await importSql(file.name)
  } finally {
    if (event?.target) event.target.value = ''
  }
}

async function clearData() {
  if (clearingData.value) return
  if (!confirm(t('settings.storage.clearDataConfirm'))) return

  clearingData.value = true
  dbMsg.value = ''

  try {
    await api.post('/api/settings/clear-data', {})
    dbMsg.value = t('settings.storage.cleared')
    dbOk.value = true
    await auth.logout()
    router.push('/login')
  } catch (e) {
    dbMsg.value = e.message
    dbOk.value = false
  } finally {
    clearingData.value = false
  }
}

watch(adminList, () => {
  resolveAdminProfiles()
})

watch(form, () => {
  syncSettingsCache()
}, { deep: true })

watch(webhookUrl, () => {
  syncSettingsCache()
})

watch(zalgoFilterEnabled, () => {
  syncSettingsCache()
  resolveAdminProfiles()
})

onMounted(load)
</script>

<style scoped>
.section{margin-bottom:0}
.resolve-card{margin-top:8px;display:flex;align-items:center;gap:12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--rs);padding:10px 14px;flex-wrap:wrap}
.utility-btn{min-width:88px;justify-content:center}
.settings-inline-row{align-items:stretch}
.settings-inline-row input{min-height:38px}
.settings-inline-btn{min-width:96px;min-height:38px;justify-content:center}
.admin-tags{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px}
.admin-tags-single{grid-template-columns:minmax(0,1fr)}
.admin-card{position:relative;width:100%;min-width:0;display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;column-gap:12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:12px 40px 12px 14px}
.admin-card-avatar{width:42px;height:42px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;overflow:hidden}
.admin-card-avatar-img{width:100%;height:100%;object-fit:cover}
.admin-card-info{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px;text-align:left}
.admin-card-name{font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-card-meta{font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-card-id{font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-card-remove{position:absolute;top:8px;right:8px;padding:2px 6px;line-height:1;align-self:auto}
@media (max-width:640px){
  .admin-tags{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .admin-tags-single{grid-template-columns:minmax(0,1fr)}
  .admin-card{grid-template-columns:36px minmax(0,1fr);column-gap:8px;padding:10px 34px 10px 10px}
  .admin-card-avatar{width:36px;height:36px;font-size:13px}
  .admin-card-name{font-size:12px}
  .admin-card-meta,.admin-card-id{font-size:11px}
  .admin-card-remove{top:6px;right:6px;padding:2px 5px}
}
.db-status{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.danger-zone{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sql-tools{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:8px 0}
.sql-tools-header{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sql-tools-actions{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.sql-textarea{max-width:100%;min-height:220px;font-family:'JetBrains Mono','Fira Code',Consolas,monospace;font-size:12px}
.sql-file-input{display:none}
.settings-card{margin-bottom:18px}
.page{max-width:720px;margin:0 auto}
.page-title-with-icon,
.sec-title-with-icon{display:flex;align-items:center;gap:8px}
</style>
