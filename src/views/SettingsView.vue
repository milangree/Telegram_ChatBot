<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">⚙️ 系统设置</h2>
      <div class="flex gap-2">
        <button class="btn-ghost btn-sm" @click="load">🔄</button>
        <button class="btn-primary" @click="save" :disabled="saving">
          <span v-if="saving" class="spinner"></span>{{ saving ? '保存中…' : '💾 保存' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex-center mt-3"><div class="spinner"></div></div>
    <template v-else>
      <transition name="fade">
        <div v-if="saved" class="alert alert-success">✅ 设置已保存</div>
      </transition>
      <div v-if="saveErr" class="alert alert-error">{{ saveErr }}</div>

      <!-- Bot 配置 -->
      <div class="card section mb-2">
        <h3 class="sec-title">🤖 Bot 配置</h3>
        <div class="form-group">
          <label>Bot Token <span class="req">*</span></label>
          <div class="row-g">
            <input v-model="form.BOT_TOKEN" type="password" placeholder="1234567890:AAF…" autocomplete="off" />
            <button class="btn-ghost btn-sm" @click="testToken" :disabled="testingTok">{{ testingTok ? '…' : '测试' }}</button>
          </div>
          <div v-if="tokResult" class="form-hint" :class="tokResult.ok ? 'text-success' : 'text-danger'">
            {{ tokResult.ok ? `✅ @${tokResult.bot.username} (ID: ${tokResult.bot.id})` : '❌ ' + tokResult.err }}
          </div>
        </div>

        <div class="form-group">
          <label>话题群组 ID <span class="req">*</span></label>
          <div class="row-g">
            <input v-model="form.FORUM_GROUP_ID" placeholder="-1001234567890 (话题群组)" />
            <button class="btn-ghost btn-sm" @click="resolveChat(form.FORUM_GROUP_ID, 'group')" :disabled="resolvingGroup">
              {{ resolvingGroup ? '…' : '🔍 解析' }}
            </button>
          </div>
          <div v-if="groupInfo" class="resolve-card">
            <span>{{ groupInfo.type === 'supergroup' ? '👥' : '💬' }}</span>
            <div><div style="font-weight:600">{{ groupInfo.title }}</div><div class="text-muted text-sm">ID: <code>{{ groupInfo.id }}</code></div></div>
            <button class="btn-primary btn-sm" @click="form.FORUM_GROUP_ID = String(groupInfo.id)">使用</button>
          </div>
          <div v-if="groupErr" class="form-hint text-danger">{{ groupErr }}</div>
        </div>

        <div class="form-group">
          <label>查询群组 / 频道 ID</label>
          <div class="row-g">
            <input v-model="chatQuery" placeholder="@username 或 -100xxxxx" />
            <button class="btn-ghost btn-sm" @click="resolveChat(chatQuery, 'custom')" :disabled="resolvingCustom">查询</button>
          </div>
          <div v-if="customInfo" class="resolve-card">
            <span>{{ {supergroup:'👥',channel:'📢'}[customInfo.type]||'💬' }}</span>
            <div style="flex:1"><div>{{ customInfo.title||customInfo.first_name }}</div><div class="text-muted text-sm">ID: {{ customInfo.id }}</div></div>
            <button class="btn-ghost btn-sm" @click="form.FORUM_GROUP_ID = String(customInfo.id)">使用此 ID</button>
            <button class="btn-ghost btn-sm" @click="addAdmin(String(customInfo.id))">设为管理员</button>
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
            <button class="btn-ghost btn-sm" @click="addAdmin(newAdminId)">+ 添加</button>
          </div>
          <div class="form-hint">管理员可在私聊查看控制台，在话题中使用管理按钮</div>
        </div>
      </div>

      <!-- Webhook -->
      <div class="card section mb-2">
        <h3 class="sec-title">🔗 Webhook</h3>
        <div class="form-group">
          <label>Webhook URL</label>
          <div class="row-g">
            <input v-model="webhookUrl" placeholder="https://xxx.pages.dev/webhook" />
            <button class="btn-primary btn-sm" @click="setWebhook" :disabled="settingWh">{{ settingWh ? '…' : '设置' }}</button>
          </div>
          <div v-if="whResult" class="form-hint" :class="whResult.ok ? 'text-success' : 'text-danger'">
            {{ whResult.ok ? '✅ ' + whResult.message : '❌ ' + whResult.err }}
          </div>
          <div class="form-hint">设置 Webhook 时会自动更新 Bot 命令列表</div>
        </div>
      </div>

      <!-- 验证配置 -->
      <div class="card section mb-2">
        <h3 class="sec-title">🔐 人机验证</h3>
        <div class="toggle-row">
          <div><div class="toggle-label">启用验证</div><div class="form-hint">新用户首次发消息须通过验证</div></div>
          <label class="toggle"><input type="checkbox" v-model="verifyEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <template v-if="verifyEnabled">
          <div class="divider"></div>
          <div class="form-group">
            <label>验证类型</label>
            <select v-model="form.CAPTCHA_TYPE">
              <option value="math">数学题（按钮选择）</option>
              <option value="image_numeric">图片验证码（4位数字）</option>
              <option value="image_alphanumeric">图片验证码（5位字母+数字）</option>
            </select>
          </div>
          <div v-if="form.CAPTCHA_TYPE !== 'math'" class="form-group">
            <label>图片验证码站点 URL</label>
            <input v-model="form.CAPTCHA_SITE_URL" placeholder="https://xxx.pages.dev（自动从 Webhook URL 获取）" />
            <div class="form-hint">设置 Webhook 后自动填写，通常无需手动填写</div>
          </div>
          <div class="toggle-row">
            <div class="toggle-label">验证超时（秒）</div>
            <input v-model.number="form.VERIFICATION_TIMEOUT" type="number" min="60" max="3600" style="width:90px" @change="clampTimeout" />
          </div>
          <div class="toggle-row">
            <div class="toggle-label">最多尝试次数</div>
            <input v-model="form.MAX_VERIFICATION_ATTEMPTS" type="number" min="1" max="10" style="width:90px" />
          </div>
        </template>
      </div>

      <!-- 功能配置 -->
      <div class="card section mb-2">
        <h3 class="sec-title">🔧 功能配置</h3>
        <div class="toggle-row">
          <div><div class="toggle-label">自动解封申诉</div><div class="form-hint">允许封禁用户发起申诉</div></div>
          <label class="toggle"><input type="checkbox" v-model="autoUnblock" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div><div class="toggle-label">白名单功能</div><div class="form-hint">白名单用户跳过验证和速率限制</div></div>
          <label class="toggle"><input type="checkbox" v-model="whitelistEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div><div class="toggle-label">过滤机器人指令</div><div class="form-hint">不将 /xxx 指令转发给管理员</div></div>
          <label class="toggle"><input type="checkbox" v-model="cmdFilter" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div><div class="toggle-label">接收管理员私聊消息</div><div class="form-hint">关闭后，管理员私聊 Bot 不再默认弹出控制台</div></div>
          <label class="toggle"><input type="checkbox" v-model="adminNotifyEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div class="toggle-label">每分钟最大消息数</div>
          <input v-model="form.MAX_MESSAGES_PER_MINUTE" type="number" min="1" max="300" style="width:90px" />
        </div>
        <div class="divider"></div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">带按钮消息自动撤回（秒）</div>
            <div class="form-hint">仅对带内联按钮消息生效，0 表示关闭；管理员私聊 /panel 也可调整</div>
          </div>
          <input v-model.number="form.INLINE_KB_MSG_DELETE_SECONDS" type="number" min="0" max="600" style="width:90px" @change="clampInlineKbDelete" />
        </div>
      </div>

      <!-- 欢迎消息 -->
      <div class="card section mb-2">
        <h3 class="sec-title">👋 /start 欢迎消息</h3>
        <div class="toggle-row">
          <div class="toggle-label">启用欢迎消息</div>
          <label class="toggle"><input type="checkbox" v-model="welcomeEnabled" /><span class="toggle-slider"></span></label>
        </div>
        <div class="form-group mt-1" v-if="welcomeEnabled">
          <label>消息内容（支持 HTML 格式）</label>
          <textarea v-model="form.WELCOME_MESSAGE" rows="5" style="resize:vertical;font-family:monospace;font-size:13px"></textarea>
        </div>
      </div>

      <!-- 数据库切换 -->
      <div class="card section mb-2">
        <h3 class="sec-title">🗄️ 数据存储</h3>
        <div class="db-status">
          <div>
            <div class="toggle-label">当前：<span :class="dbInfo.active === 'd1' ? 'text-success' : 'text-warn'">{{ dbInfo.active === 'd1' ? 'D1 SQL 数据库' : 'KV 键值存储' }}</span></div>
            <div class="form-hint" v-if="!dbInfo.hasD1">D1 未绑定 — 在 Pages 设置中添加 D1 绑定（变量名 <code>D1</code>）后才可切换</div>
          </div>
          <div class="flex gap-2" v-if="dbInfo.hasD1">
            <button class="btn-ghost btn-sm" :class="{ 'btn-primary': dbInfo.active === 'kv' }" :disabled="dbSwitching || dbInfo.active === 'kv'" @click="switchDb('kv', true)">KV</button>
            <button class="btn-ghost btn-sm" :class="{ 'btn-primary': dbInfo.active === 'd1' }" :disabled="dbSwitching || dbInfo.active === 'd1'" @click="switchDb('d1', true)">D1 SQL</button>
          </div>
        </div>
        <div v-if="dbSwitching" class="flex gap-2 mt-1"><div class="spinner"></div><span class="text-muted text-sm">正在同步数据并切换…</span></div>
        <div v-if="dbMsg" class="form-hint mt-1" :class="dbOk ? 'text-success' : 'text-danger'">{{ dbMsg }}</div>
        <div class="form-hint mt-1">切换时会自动将全量数据从旧存储同步到新存储，可安全切换。</div>
      </div>

      <div style="text-align:right;margin-top:12px">
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
const loading = ref(true), saving = ref(false), saved = ref(false), saveErr = ref('')
const testingTok = ref(false), tokResult = ref(null)
const webhookUrl = ref(''), settingWh = ref(false), whResult = ref(null)
const chatQuery = ref(''), resolvingCustom = ref(false), customInfo = ref(null)
const resolvingGroup = ref(false), groupInfo = ref(null), groupErr = ref('')
const newAdminId = ref('')
const dbInfo = ref({ active: 'kv', hasD1: false }), dbSwitching = ref(false), dbMsg = ref(''), dbOk = ref(true)

const boolProp = key => computed({ get: () => form.value[key] === 'true', set: v => { form.value[key] = v ? 'true' : 'false' } })
const verifyEnabled   = boolProp('VERIFICATION_ENABLED')
const autoUnblock     = boolProp('AUTO_UNBLOCK_ENABLED')
const whitelistEnabled = boolProp('WHITELIST_ENABLED')
const cmdFilter       = boolProp('BOT_COMMAND_FILTER')
const adminNotifyEnabled = boolProp('ADMIN_NOTIFY_ENABLED')
const welcomeEnabled  = boolProp('WELCOME_ENABLED')

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
    form.value   = data
    dbInfo.value = db
    // Restore saved webhook URL
    if (data.WEBHOOK_URL) webhookUrl.value = data.WEBHOOK_URL
  } catch (e) { saveErr.value = '加载失败: ' + e.message }
  finally { loading.value = false }
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
  // Enforce minimum before saving
  clampTimeout()
  clampInlineKbDelete()
  saving.value = true; saved.value = false; saveErr.value = ''
  try { await api.put('/api/settings', form.value); saved.value = true; setTimeout(() => saved.value = false, 3000) }
  catch (e) { saveErr.value = e.message }
  finally { saving.value = false }
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
    dbInfo.value.active = target; dbMsg.value = `✅ 已切换到 ${target === 'd1' ? 'D1 SQL' : 'KV'}`; dbOk.value = true
  } catch (e) { dbMsg.value = '❌ ' + e.message; dbOk.value = false }
  finally { dbSwitching.value = false }
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
