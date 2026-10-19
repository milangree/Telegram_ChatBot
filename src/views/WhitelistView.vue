<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title page-title-with-icon">
        <AppIcon
          name="whitelist"
          :size="20"
        />
        {{ t('whitelist.title') }}
      </h2>
      <button
        class="btn-ghost btn-sm"
        :title="t('whitelist.refresh')"
        @click="load"
      >
        <AppIcon
          name="refresh"
          :size="14"
        />
        {{ t('whitelist.refresh') }}
      </button>
    </div>

    <div class="card mb-2">
      <h3 class="sec-title sec-title-with-icon">
        <AppIcon
          name="add"
          :size="18"
        />
        {{ t('whitelist.addUser') }}
      </h3>
      <div class="quick-row">
        <UserSearchPicker
          v-model="addId"
          :placeholder="t('whitelist.search')"
          style="flex:1"
          @selected="onPickAddUser"
        />
        <input
          v-model="addReason"
          :placeholder="t('whitelist.reasonOptional')"
          style="flex:1"
        >
        <button
          class="btn-primary btn-sm"
          :disabled="!addId || adding"
          @click="doAdd"
        >
          <span
            v-if="adding"
            class="spinner"
          />
          <AppIcon
            v-else
            name="add"
            :size="14"
          />
          {{ t('whitelist.add') }}
        </button>
      </div>
      <div class="form-hint mt-1">
        {{ t('whitelist.tip') }}
      </div>
    </div>

    <div class="card">
      <div
        v-if="loading"
        class="skeleton-stack"
        style="padding:8px 0"
      >
        <div
          v-for="i in 4"
          :key="i"
          class="skeleton-row"
        >
          <div class="skeleton skeleton-ava" />
          <div
            class="skeleton-stack"
            style="flex:1"
          >
            <div class="skeleton skeleton-line" />
            <div class="skeleton skeleton-line sm" />
          </div>
        </div>
      </div>
      <template v-else>
        <div
          v-if="!users.length"
          class="empty-state"
        >
          <div class="empty-state-icon">
            <AppIcon
              name="whitelist"
              :size="24"
            />
          </div>
          <div class="empty-state-title">
            {{ t('whitelist.empty') }}
          </div>
        </div>
        <div
          v-else
          style="overflow-x:auto"
        >
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('whitelist.table.user') }}</th>
                <th class="hide-mobile">
                  {{ t('whitelist.table.telegramId') }}
                </th>
                <th>{{ t('whitelist.table.reason') }}</th>
                <th class="hide-mobile">
                  {{ t('whitelist.table.addedAt') }}
                </th>
                <th>{{ t('whitelist.table.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="u in users"
                :key="u.user_id"
              >
                <td>
                  <div class="user-cell">
                    <div class="u-ava">
                      <img
                        v-if="avatars[u.user_id]"
                        :src="avatars[u.user_id]"
                        class="ava-img"
                        @error="avatars[u.user_id] = ''"
                      >
                      <span v-else>{{ (u.first_name || u.username || '?')[0].toUpperCase() }}</span>
                    </div>
                    <div class="user-cell-line">
                      <span class="u-name">{{ formatDisplayName(u) }}</span>
                      <span class="user-cell-sep">·</span>
                      <span class="user-cell-meta">
                        <button
                          v-if="u.username"
                          type="button"
                          class="id-copy"
                          :title="t('common.copy')"
                          @click="copyUsername(u.username)"
                        >@{{ u.username }}</button>
                        <template v-else>—</template>
                      </span>
                    </div>
                  </div>
                </td>
                <td class="hide-mobile">
                  <button
                    type="button"
                    class="id-copy"
                    :title="t('common.copy')"
                    @click="copyTelegramId(u.user_id)"
                  >
                    {{ u.user_id }}
                  </button>
                </td>
                <td class="text-muted text-sm">
                  {{ u.reason || '—' }}
                </td>
                <td class="hide-mobile text-muted text-sm">
                  {{ fmtDate(u.created_at) }}
                </td>
                <td>
                  <div class="row-actions">
                    <RouterLink
                      :to="`/conversations?user=${u.user_id}`"
                      class="btn-ghost btn-sm action-link-icon"
                      :title="t('users.messages')"
                    >
                      <AppIcon
                        name="conversations"
                        :size="14"
                      />
                    </RouterLink>
                    <button
                      class="btn-danger btn-sm"
                      :title="t('whitelist.remove')"
                      @click="doRemove(u)"
                    >
                      <AppIcon
                        name="delete"
                        :size="14"
                      />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="total > pageSize"
          class="pagination-bar"
        >
          <div class="pagination-meta">
            <span class="text-muted text-sm">{{ t('whitelist.pageInfo', { page, total }) }}</span>
          </div>
          <div class="pagination-actions">
            <button
              class="btn-ghost btn-sm"
              :disabled="page <= 1"
              @click="page--; load()"
            >
              <AppIcon
                name="chevron-left"
                :size="14"
              />
              {{ t('users.prevPage') }}
            </button>
            <button
              class="btn-ghost btn-sm"
              :disabled="page * pageSize >= total"
              @click="page++; load()"
            >
              {{ t('users.nextPage') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'
import { useI18nStore } from '../stores/i18n'
import { useDialog } from '../stores/dialog.js'
import { useToast } from '../stores/toast.js'

const i18n = useI18nStore()
const t = i18n.t
const dialog = useDialog()
const toast = useToast()

const users = ref([]), total = ref(0), page = ref(1), pageSize = 20
const loading = ref(true)
const addId = ref(''), addReason = ref(''), adding = ref(false)
const avatars = ref({})
const addPickedUser = ref(null)

function formatDisplayName(u) {
  if (!u) return ''
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || (u.username ? `@${u.username}` : String(u.user_id))
}

function formatConfirmName(uOrId) {
  const u = (uOrId && typeof uOrId === 'object')
    ? uOrId
    : (users.value.find(x => String(x.user_id) === String(uOrId))
      || (addPickedUser.value && String(addPickedUser.value.user_id) === String(uOrId) ? addPickedUser.value : null)
      || { user_id: uOrId })
  if (u.username) return `@${u.username}`
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || String(u.user_id || uOrId || '')
}

function loadAvatar(uid) {
  if (!uid || avatars.value[uid]) return
  const img = new Image()
  img.onload = () => { avatars.value[uid] = `/api/users/${uid}/avatar` }
  img.onerror = () => {}
  img.src = `/api/users/${uid}/avatar`
}

function onPickAddUser(u) {
  addId.value = String(u.user_id)
  addPickedUser.value = u
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

async function load() {
  loading.value = true
  try {
    const d = await api.get(`/api/whitelist?page=${page.value}`)
    users.value = d.users; total.value = d.total
    for (const u of users.value) loadAvatar(u.user_id)
  } finally { loading.value = false }
}

async function doAdd() {
  if (!addId.value) return
  const ok = await dialog.confirm({
    title: t('users.addWhitelist'),
    message: t('whitelist.addConfirm', { name: formatConfirmName(addPickedUser.value || addId.value) }),
    confirmText: t('whitelist.add'),
  })
  if (!ok) return
  adding.value = true
  try {
    await api.post(`/api/whitelist/${addId.value}`, { reason: addReason.value })
    toast.success(t('whitelist.addSuccess', { id: addId.value }))
    addId.value = ''; addReason.value = ''; addPickedUser.value = null
    await load()
  } catch (e) {
    toast.error(e.message)
  } finally {
    adding.value = false
  }
}

async function doRemove(u) {
  const ok = await dialog.confirm({
    title: t('whitelist.remove'),
    message: t('whitelist.removeConfirm', { name: formatConfirmName(u) }),
    danger: true,
    confirmText: t('whitelist.remove'),
  })
  if (!ok) return
  try {
    await api.delete(`/api/whitelist/${u.user_id}`)
    users.value = users.value.filter(x => x.user_id !== u.user_id)
    total.value--
    toast.success(t('users.flash.removedWhitelist'))
  } catch (e) {
    toast.error(e.message)
  }
}

function fmtDate(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return '—'
  }
}
onMounted(load)
</script>

<style scoped>
.page{max-width:980px;margin:0 auto}
.quick-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.user-cell{display:flex;align-items:center;gap:10px;min-width:0}
.user-cell-line{min-width:0;display:flex;align-items:center;gap:6px;white-space:nowrap}
.u-name{min-width:0;font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis}
.user-cell-meta{min-width:0;font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis}
.user-cell-sep{color:var(--text3);flex-shrink:0}
.u-ava{width:32px;height:32px;border-radius:50%;flex-shrink:0;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;overflow:hidden}
.ava-img{width:100%;height:100%;object-fit:cover}
.user-id{
  font:inherit;font-size:inherit;line-height:inherit;
  display:inline;background:transparent!important;border-radius:0;padding:0;
  font-variant-numeric:tabular-nums;color:inherit;
}
.id-copy:hover,
.id-copy:hover code{color:var(--accent)}
@media (max-width:768px){
  .page{max-width:100%}
  .quick-row > *{min-width:0}
}
</style>
