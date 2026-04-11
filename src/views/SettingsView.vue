<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">⚙️ 系统设置</h2>
      <button class="btn-primary" @click="save" :disabled="saving">
        <span v-if="saving" class="spinner"></span>{{ saving ? '保存中…' : '💾 保存设置' }}
      </button>
    </div>

    <div v-if="loading" class="flex-center mt-3"><div class="spinner"></div></div>
    <template v-else>
      <div v-if="saved" class="alert alert-success">✅ 设置已保存</div>
      <div v-if="saveErr" class="alert alert-error">{{ saveErr }}</div>

      <!-- Bot 配置 -->
      <div class="card section">
        <h3 class="sec-title">🤖 Bot 配置</h3>
        <div class="form-group">
          <label>Bot Token <span class="req">*</span></label>
          <div class="row-g">
            <input 
              v-model="form.BOT_TOKEN" 
              type="password" 
              placeholder="1234567890:AAF…" 
              autocomplete="off"
            />
            <button class="btn-ghost btn-sm" @click="testToken" :disabled="testingTok">
              {{ testingTok ? '测试中…' : '测试' }}
            </button>
          </div>
          <div v-if="tokResult" class="form-hint" :class="tokResult.ok ? 'text-success' : 'text-danger'">
            {{ tokResult.ok ? `✅ @${tokResult.bot.username} (ID: ${tokResult.bot.id})` : '❌ ' + tokResult.err }}
          </div>
        </div>
      </div>

      <!-- 群组与管理员 -->
      <div class="card section">
        <h3 class="sec-title">👥 群组与管理员</h3>
        
        <div class="form-group">
          <label>论坛群组 ID <span class="req">*</span></label>
          <div class="row-g">
            <input v-model="form.FORUM_GROUP_ID" placeholder="-1001234567890" />
            <button class="btn-ghost btn-sm" @click="resolveChat(form.FORUM_GROUP_ID, 'group')" :disabled="resolvingGroup">
              {{ resolvingGroup ? '获取中…' : '🔍 解析' }}
            </button>
          </div>
          <div v-if="groupInfo" class="resolve-card">
            <div class="resolve-icon">{{ groupInfo.type === 'supergroup' ? '👥' : '💬' }}</div>
            <div>
              <div style="font-weight:600">{{ groupInfo.title }}</div>
              <div class="text-muted text-sm">ID: <code>{{ groupInfo.id }}</code></div>
            </div>
            <button class="btn-primary btn-sm" @click="form.FORUM_GROUP_ID = String(groupInfo.id)">使用此 ID</button>
          </div>
          <div v-if="groupErr" class="form-hint text-danger">{{ groupErr }}</div>
        </div>

        <div class="form-group">
          <label>🔍 查询群组 / 频道 ID</label>
          <div class="row-g">
            <input v-model="chatQuery" placeholder="输入 @username 或 ID" />
            <button class="btn-ghost btn-sm" @click="resolveChat(chatQuery, 'custom')" :disabled="resolvingCustom">
              {{ resolvingCustom ? '查询中…' : '查询' }}
            </button>
          </div>
          <div v-if="customInfo" class="resolve-card">
            <div class="resolve-icon">{{ { supergroup: '👥', channel: '📢' }[customInfo.type] || '💬' }}</div>
            <div style="flex:1">
              <div>{{ customInfo.title || customInfo.first_name }}</div>
              <div class="text-muted">ID: {{ customInfo.id }}</div>
            </div>
            <button class="btn-ghost btn-sm" @click="form.FORUM_GROUP_ID = String(customInfo.id)">设为群组</button>
            <button class="btn-ghost btn-sm" @click="addAdminId(String(customInfo.id))">设为管理员</button>
          </div>
        </div>

        <div class="form-group">
          <label>管理员 Telegram ID</label>
          <div class="admin-tags">
            <div v-for="(id, i) in adminList" :key="i" class="admin-tag">
              {{ id }}
              <button @click="removeAdmin(i)">✕</button>
            </div>
          </div>
          <div class="row-g">
            <UserSearchPicker v-model="newAdminId" @selected="u => newAdminId = String(u.user_id)" />
            <button class="btn-ghost btn-sm" @click="addAdminId(newAdminId)">+ 添加</button>
          </div>
        </div>
      </div>

      <!-- Webhook -->
      <div class="card section">
        <h3 class="sec-title">🔗 Webhook</h3>
        <div class="form-group">
          <label>Webhook URL</label>
          <div class="row-g">
            <input v-model="webhookUrl" placeholder="https://your-project.pages.dev/webhook" />
            <button class="btn-primary btn-sm" @click="setWebhook" :disabled="settingWh">
              {{ settingWh ? '设置中…' : '设置 Webhook' }}
            </button>
          </div>
          <div v-if="whResult" class="form-hint" :class="whResult.ok ? 'text-success' : 'text-danger'">
            {{ whResult.ok ? '✅ ' + whResult.message : '❌ ' + whResult.err }}
          </div>
        </div>
      </div>

      <!-- 功能配置 -->
      <div class="card section">
        <h3 class="sec-title">🔧 功能配置</h3>
        
        <div class="toggle-row">
          <div>
            <div class="toggle-label">人机验证</div>
            <div class="form-hint">新用户首次发消息须通过验证</div>
          </div>
          <label class="toggle">
            <input type="checkbox" v-model="verifyEnabled" />
            <span class="toggle-slider"></span>
          </label>
        </div>
        
        <template v-if="verifyEnabled">
          <hr class="divider" />
          <div class="toggle-row">
            <div class="toggle-label">验证超时（秒）</div>
            <input v-model="form.VERIFICATION_TIMEOUT" type="number" style="width: 90px" />
          </div>
          <div class="toggle-row">
            <div class="toggle-label">最大尝试次数</div>
            <input v-model="form.MAX_VERIFICATION_ATTEMPTS" type="number" style="width: 90px" />
          </div>
        </template>
        
        <hr class="divider" />
        <div class="toggle-row">
          <div>
            <div class="toggle-label">自动解封申诉</div>
            <div class="form-hint">允许被封禁用户发起申诉</div>
          </div>
          <label class="toggle">
            <input type="checkbox" v-model="autoUnblock" />
            <span class="toggle-slider"></span>
          </label>
        </div>
        
        <hr class="divider" />
        <div class="toggle-row">
          <div class="toggle-label">每分钟最大消息数</div>
          <input v-model="form.MAX_MESSAGES_PER_MINUTE" type="number" style="width: 90px" />
        </div>
      </div>

      <div style="text-align: right; margin-top: 16px">
        <button class="btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="spinner"></span>{{ saving ? '保存中…' : '💾 保存所有设置' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'

const form = ref({})
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const saveErr = ref('')

const testingTok = ref(false)
const tokResult = ref(null)

const webhookUrl = ref('')
const settingWh = ref(false)
const whResult = ref(null)

const chatQuery = ref('')
const resolvingCustom = ref(false)
const customInfo = ref(null)
const customErr = ref('')

const resolvingGroup = ref(false)
const groupInfo = ref(null)
const groupErr = ref('')

const newAdminId = ref('')

const verifyEnabled = computed({
  get: () => form.value.VERIFICATION_ENABLED === 'true',
  set: v => { form.value.VERIFICATION_ENABLED = v ? 'true' : 'false' }
})

const autoUnblock = computed({
  get: () => form.value.AUTO_UNBLOCK_ENABLED === 'true',
  set: v => { form.value.AUTO_UNBLOCK_ENABLED = v ? 'true' : 'false' }
})

const adminList = computed({
  get: () => (form.value.ADMIN_IDS || '').split(',').filter(s => s.trim()),
  set: arr => { form.value.ADMIN_IDS = arr.join(',') }
})

function addAdminId(id) {
  const v = String(id).trim()
  if (!v) return
  if (!adminList.value.includes(v)) {
    adminList.value = [...adminList.value, v]
  }
  newAdminId.value = ''
}

function removeAdmin(i) {
  const a = [...adminList.value]
  a.splice(i, 1)
  adminList.value = a
}

async function loadSettings() {
  loading.value = true
  try {
    console.log('Loading settings...')
    const data = await api.get('/api/settings')
    console.log('Settings loaded:', data)
    form.value = data
  } catch (e) {
    console.error('Load settings error:', e)
    saveErr.value = '加载设置失败: ' + e.message
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  saved.value = false
  saveErr.value = ''
  try {
    console.log('Saving settings...', form.value)
    await api.put('/api/settings', form.value)
    saved.value = true
    setTimeout(() => (saved.value = false), 3000)
  } catch (e) {
    console.error('Save error:', e)
    saveErr.value = e.message
  } finally {
    saving.value = false
  }
}

async function testToken() {
  testingTok.value = true
  tokResult.value = null
  try {
    console.log('Testing token...')
    const d = await api.post('/api/settings/test-token', { token: form.value.BOT_TOKEN })
    tokResult.value = d
    console.log('Token test result:', d)
  } catch (e) {
    console.error('Token test error:', e)
    tokResult.value = { ok: false, err: e.message }
  } finally {
    testingTok.value = false
  }
}

async function resolveChat(val, which) {
  if (!val) return
  if (which === 'group') {
    resolvingGroup.value = true
    groupInfo.value = null
    groupErr.value = ''
  } else {
    resolvingCustom.value = true
    customInfo.value = null
    customErr.value = ''
  }
  try {
    console.log('Resolving chat:', val)
    const d = await api.post('/api/tg/resolve-chat', { chatId: val })
    if (which === 'group') {
      groupInfo.value = d.chat
    } else {
      customInfo.value = d.chat
    }
  } catch (e) {
    console.error('Resolve chat error:', e)
    if (which === 'group') {
      groupErr.value = e.message
    } else {
      customErr.value = e.message
    }
  } finally {
    if (which === 'group') {
      resolvingGroup.value = false
    } else {
      resolvingCustom.value = false
    }
  }
}

async function setWebhook() {
  settingWh.value = true
  whResult.value = null
  try {
    console.log('Setting webhook:', webhookUrl.value)
    const d = await api.post('/api/settings/webhook', { webhookUrl: webhookUrl.value })
    whResult.value = d
  } catch (e) {
    console.error('Set webhook error:', e)
    whResult.value = { ok: false, err: e.message }
  } finally {
    settingWh.value = false
  }
}

onMounted(() => {
  console.log('SettingsView mounted')
  loadSettings()
})
</script>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
}

.section {
  margin-bottom: 16px;
}

.sec-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
}

.req {
  color: var(--danger);
}

.row-g {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row-g input {
  flex: 1;
}

.toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 8px 0;
}

.toggle-label {
  font-size: 13px;
  font-weight: 500;
}

.text-success {
  color: var(--success);
}

.text-danger {
  color: var(--danger);
}

.resolve-card {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--rs);
  padding: 10px 14px;
}

.resolve-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.admin-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.admin-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-dim);
  border: 1px solid rgba(79, 142, 247, 0.3);
  color: var(--accent);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
}

.admin-tag button {
  background: none;
  border: none;
  color: var(--danger);
  cursor: pointer;
  padding: 0 2px;
  font-size: 12px;
}

.divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}

.mt-2 {
  margin-top: 16px;
}

.mt-3 {
  margin-top: 24px;
}
</style>
