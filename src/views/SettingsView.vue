<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">⚙️ {{ t('settings.title') }}</h2>
      <div class="flex gap-2">
        <button class="btn-ghost btn-sm" @click="load">🔄</button>
        <button class="btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="spinner"></span>{{ saving ? t('settings.saving') : `💾 ${t('settings.save')}` }}
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
      <div class="card section mb-2">
        <h3 class="sec-title">🤖 {{ t('settings.section.bot') }}</h3>
        <div class="form-group">
          <label>{{ t('settings.config.botToken') }} <span class="req">*</span></label>
          <div class="row-g">
            <input v-model="form.BOT_TOKEN" type="password" :placeholder="t('settings.token.placeholder')" autocomplete="off" />
            <button class="btn-ghost btn-sm" @click="testToken" :disabled="testingTok">{{ testingTok ? '…' : t('settings.token.test') }}</button>
          </div>
          <div v-if="tokResult" class="form-hint" :class="tokResult.ok ? 'text-success' : 'text-danger'">
            {{ tokResult.ok ? t('settings.token.valid', { username: tokResult.bot.username, id: tokResult.bot.id }) : '❌ ' + tokResult.err }}
          </div>
        </div>

        <div class="form-group">
          <label>{{ t('settings.topicGroupId') }} <span class="req">*</span></label>
          <div class="row-g">
            <input v-model="form.FORUM_GROUP_ID" :placeholder="t('settings.topicGroupPh')" />
            <button class="btn-ghost btn-sm" @click="resolveChat(form.FORUM_GROUP_ID, 'group')" :disabled="resolvingGroup">
              {{ resolvingGroup ? '…' : `🔍 ${t('settings.resolve')}` }}
            </button>
          </div>
          <div v-if="groupInfo" class="resolve-card">
            <span>{{ groupInfo.type === 'supergroup' ? '👥' : '💬' }}</span>
            <div>
              <div style="font-weight:600">{{ groupInfo.title }}</div>
              <div class="text-muted text-sm">{{ t('common.id') }}: <code>{{ groupInfo.id }}</code></div>
            </div>
            <button class="btn-primary btn-sm" @click="form.FORUM_GROUP_ID = String(groupInfo.id)">{{ t('settings.use') }}</button>
          </div>
          <div v-if="groupErr" class="form-hint text-danger">{{ groupErr }}</div>
        </div>

        <div class="form-group">
          <label>{{ t('settings.queryChat') }}</label>
          <div class="row-g">
            <input v-model="chatQuery" :placeholder="t('settings.queryPh')" />
            <button class="btn-ghost btn-sm" @click="resolveChat(chatQuery, 'custom')" :disabled="resolvingCustom">{{ resolvingCustom ? '…' : t('settings.query') }}</button>
          </div>
          <div v-if="customInfo" class="resolve-card">
            <span>{{ { supergroup: '👥', channel: '📢' }[customInfo.type] || '💬' }}</span>
            <div style="flex:1">
              <div>{{ customInfo.title || customInfo.first_name }}</div>
              <div class="text-muted text-sm">{{ t('common.id') }}: {{ customInfo.id }}</div>
            </div>
            <button class="btn-ghost btn-sm" @click="form.FORUM_GROUP_ID = String(customInfo.id)">{{ t('settings.useId') }}</button>
            <button class="btn-ghost btn-sm" @click="addAdmin(String(customInfo.id))">{{ t('settings.setAdmin') }}</button>
          </div>
        </div>

        <div class="form-group">
          <label>{{ t('settings.adminIds') }}</label>
          <div class="admin-tags">
            <div v-for="(id, i) in adminList" :key="i" class="admin-tag">
              {{ id }}
              <button @click="removeAdmin(i)">✕</button>
            </div>
          </div>
          <div class="row-g">
            <UserSearchPicker v-model="newAdminId" @selected="u => newAdminId = String(u.user_id)" />
            <button class="btn-ghost btn-sm" @click="addAdmin(newAdminId)">{{ t('settings.add') }}</button>
          </div>
          <div class="form-hint">{{ t('settings.adminHint') }}</div>
        </div>
      </div>

      <!-- Webhook -->
      <div class="card section mb-2">
        <h3 class="sec-title">🔗 {{ t('settings.section.webhook') }}</h3>
        <div class="form-group">
          <label>{{ t('settings.webhookUrl') }}</label>
          <div class="row-g">
            <input v-model="webhookUrl" :placeholder="t('settings.webhook.placeholder')" />
            <button class="btn-primary btn-sm" @click="setWebhook" :disabled="settingWh">{{ settingWh ? '…' : t('settings.webhookSet') }}</button>
          </div>
          <div v-if="whResult" class="form-hint" :class="whResult.ok ? 'text-success' : 'text-danger'">
            {{ whResult.ok ? '✅ ' + whResult.message : '❌ ' + whResult.err }}
          </div>
          <div class="form-hint">{{ t('settings.webhookHint') }}</div>
        </div>
      </div>

      <!-- 验证配置 -->
      <div class="card section mb-2">
        <h3 class="sec-title">🔐 {{ t('settings.section.verify') }}</h3>
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
          <div v-if="form.CAPTCHA_TYPE !== 'math'" class="form-group">
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
      <div class="card section mb-2">
        <h3 class="sec-title">🔧 {{ t('settings.section.feature') }}</h3>
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
          <div class="toggle-label">{{ t('settings.feature.maxPerMin') }}</div>
          <input v-model="form.MAX_MESSAGES_PER_MINUTE" type="number" min="1" max="300" style="width:90px" />
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">{{ t('settings.feature.inlineKbDelete') }}</div>
            <div class="form-hint">{{ t('settings.feature.inlineKbDeleteHint') }}</div>
          </div>
          <input v-model.number="form.INLINE_KB_MSG_DELETE_SECONDS" type="number" min="0" max="600" style="width:90px" @change="clampInlineKbDelete" />
        </div>
      </div>

      <!-- 欢迎消息 -->
      <div class="card section mb-2">
        <h3 class="sec-title">👋 {{ t('settings.section.welcome') }}</h3>
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
      <div class="card section mb-2">
        <h3 class="sec-title">🗄️ {{ t('settings.section.storage') }}</h3>
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
      </div>

      <div style="text-align:right;margin-top:12px">
        <button class="btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="spinner"></span>{{ saving ? t('settings.saving') : `💾 ${t('settings.saveAll')}` }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'
import { useI18nStore } from '../stores/i18n'

const i18n = useI18nStore()
const t = i18n.t

const form = ref({})
const loading = ref(true), saving = ref(false), saved = ref(false), saveErr = ref('')
const testingTok = ref(false), tokResult = ref(null)
const webhookUrl = ref(''), settingWh = ref(false), whResult = ref(null)
const chatQuery = ref(''), resolvingCustom = ref(false), customInfo = ref(null)
const resolvingGroup = ref(false), groupInfo = ref(null), groupErr = ref('')
const newAdminId = ref('')
const dbInfo = ref({ active: 'kv', hasD1: false }), dbSwitching = ref(false), dbMsg = ref(''), dbOk = ref(true)

const boolProp = key => computed({ get: () => form.value[key] === 'true', set: v => { form.value[key] = v ? 'true' : 'false' } })
const verifyEnabled = boolProp('VERIFICATION_ENABLED')
const autoUnblock = boolProp('AUTO_UNBLOCK_ENABLED')
const whitelistEnabled = boolProp('WHITELIST_ENABLED')
const cmdFilter = boolProp('BOT_COMMAND_FILTER')
const adminNotifyEnabled = boolProp('ADMIN_NOTIFY_ENABLED')
const welcomeEnabled = boolProp('WELCOME_ENABLED')

const adminList = computed({
  get: () => (form.value.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  set: arr => { form.value.ADMIN_IDS = arr.join(',') },
})
function addAdmin(id) { const v = String(id).trim(); if (v && !adminList.value.includes(v)) adminList.value = [...adminList.value, v]; newAdminId.value = '' }
function removeAdmin(i) { const a = [...adminList.value]; a.splice(i, 1); adminList.value = a }

async function load() {
  loading.value = true
  try {
    const [data, db] = await Promise.all([api.get('/api/settings'), api.get('/api/settings/db')])
    form.value = data
    dbInfo.value = db
    if (data.WEBHOOK_URL) webhookUrl.value = data.WEBHOOK_URL
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
    await api.put('/api/settings', form.value)
    saved.value = true
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
  try { whResult.value = await api.post('/api/settings/webhook', { webhookUrl: webhookUrl.value }) }
  catch (e) { whResult.value = { ok: false, err: e.message } }
  finally { settingWh.value = false }
}
async function switchDb(target, sync = true) {
  dbSwitching.value = true; dbMsg.value = ''
  try {
    await api.post('/api/settings/db/switch', { target, sync })
    dbInfo.value.active = target
    dbMsg.value = t('settings.storage.switched', { target: target === 'd1' ? t('settings.storage.d1Short') : t('settings.storage.kvShort') })
    dbOk.value = true
  } catch (e) {
    dbMsg.value = '❌ ' + e.message
    dbOk.value = false
  } finally {
    dbSwitching.value = false
  }
}
onMounted(load)
</script>

<style scoped>
.section{margin-bottom:0}
.resolve-card{margin-top:8px;display:flex;align-items:center;gap:12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--rs);padding:10px 14px;flex-wrap:wrap}
.admin-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:8px}
.admin-tag{display:flex;align-items:center;gap:4px;background:var(--accent-dim);border:1px solid rgba(79,142,247,.3);color:var(--accent);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600}
.admin-tag button{background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;padding:0 2px}
.db-status{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.page{max-width:720px;margin:0 auto}
</style>
