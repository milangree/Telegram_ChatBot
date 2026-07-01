<template>
  <v-autocomplete
    v-model="selected"
    v-model:search="searchQuery"
    :items="results"
    :loading="loading"
    :placeholder="placeholder || t('users.searchUser')"
    :no-data-text="searchQuery?.length > 0 ? t('picker.empty') : ''"
    item-title="display_name"
    item-value="user_id"
    return-object
    hide-no-data
    clearable
    @update:search="onSearch"
    @update:model-value="onSelect"
  >
    <template #item="{ item, props: itemProps }">
      <v-list-item v-bind="itemProps">
        <template #prepend>
          <v-avatar color="primary" size="32" rounded="circle" class="mr-2">
            <span class="text-white text-caption font-weight-bold">
              {{ (item.raw.first_name || item.raw.username || '?')[0].toUpperCase() }}
            </span>
          </v-avatar>
        </template>
        <template #subtitle>
          <span v-if="item.raw.username" class="text-medium-emphasis">@{{ item.raw.username }}</span>
          <span class="ml-2 text-caption">{{ item.raw.user_id }}</span>
          <v-chip v-if="item.raw.is_blocked" color="error" size="x-small" variant="tonal" class="ml-1">
            {{ t('picker.blocked') }}
          </v-chip>
        </template>
      </v-list-item>
    </template>
    <template #append><slot name="append" /></template>
  </v-autocomplete>
</template>

<script setup>
import { ref, watch } from 'vue'
import api from '../stores/api.js'
import { useI18nStore } from '../stores/i18n'
import { readLocalCache, writeLocalCache } from '../stores/local-cache.js'

const i18n = useI18nStore()
const t = i18n.t

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'selected'])

const selected = ref(null)
const searchQuery = ref('')
const results = ref([])
const loading = ref(false)

let timer = null
let searchSeq = 0

function onSearch(val) {
  emit('update:modelValue', val || '')
  clearTimeout(timer)
  const trimmed = String(val || '').trim()
  if (!trimmed) { results.value = []; return }
  timer = setTimeout(() => doSearch(trimmed), 250)
}

async function doSearch(keyword) {
  const currentSeq = ++searchSeq
  const cacheKey = `users:search:${keyword.toLowerCase()}`
  const cached = readLocalCache(cacheKey, { ttlMs: 5 * 60 * 1000 })

  if (Array.isArray(cached)) {
    results.value = cached.map(u => ({ ...u, display_name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || String(u.user_id) }))
    return
  }

  loading.value = true
  try {
    const data = await api.get(`/api/users/search?q=${encodeURIComponent(keyword)}`)
    if (currentSeq !== searchSeq) return
    const mapped = data.map(u => ({ ...u, display_name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || String(u.user_id) }))
    results.value = mapped
    writeLocalCache(cacheKey, data)
  } catch {
    if (currentSeq === searchSeq) results.value = []
  } finally {
    if (currentSeq === searchSeq) loading.value = false
  }
}

function onSelect(user) {
  if (!user) return
  emit('update:modelValue', String(user.user_id))
  emit('selected', user)
}

watch(() => props.modelValue, (v) => {
  if (v && v !== searchQuery.value) searchQuery.value = v
})
</script>
