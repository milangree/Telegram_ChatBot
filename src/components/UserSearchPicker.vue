<template>
  <div class="id-picker" ref="root">
    <div class="input-row">
      <input
        v-model="query"
        :placeholder="placeholder"
        @input="onInput"
        @focus="open=true"
        @keydown.esc="open=false"
        autocomplete="off"
      />
      <slot name="append" />
    </div>

    <div v-if="open && (results.length || loading || query.length > 0)" class="id-dropdown">
      <div v-if="loading" class="id-dropdown-item text-muted">搜索中…</div>
      <div v-else-if="!results.length" class="id-dropdown-item text-muted">未找到匹配用户</div>
      <div
        v-for="u in results"
        :key="u.user_id"
        class="id-dropdown-item"
        @mousedown.prevent="select(u)"
      >
        <div class="user-ava-sm">{{ (u.first_name||u.username||'?')[0].toUpperCase() }}</div>
        <div>
          <div style="font-weight:500">{{ u.first_name }} {{ u.last_name }}</div>
          <div class="text-sm text-muted">{{ u.username ? '@'+u.username : '' }}</div>
        </div>
        <span class="item-id">{{ u.user_id }}</span>
        <span v-if="u.is_blocked" class="badge badge-danger" style="font-size:9px">封</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '../stores/api.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '搜索用户名 / ID…' },
})
const emit = defineEmits(['update:modelValue', 'selected'])

const query   = ref(props.modelValue)
const results = ref([])
const loading = ref(false)
const open    = ref(false)
const root    = ref(null)

let timer = null
function onInput() {
  emit('update:modelValue', query.value)
  clearTimeout(timer)
  if (!query.value) { results.value = []; return }
  timer = setTimeout(doSearch, 300)
}
async function doSearch() {
  loading.value = true
  try { results.value = await api.get(`/api/users/search?q=${encodeURIComponent(query.value)}`) }
  catch { results.value = [] }
  finally { loading.value = false }
}
function select(u) {
  query.value = String(u.user_id)
  emit('update:modelValue', String(u.user_id))
  emit('selected', u)
  open.value = false
}

function onClickOutside(e) { if (root.value && !root.value.contains(e.target)) open.value = false }

watch(() => props.modelValue, (v) => {
  if (v !== query.value) query.value = v || ''
})

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<style scoped>
.input-row { display:flex; gap:8px; align-items:center }
.input-row input { flex:1 }
.user-ava-sm { width:28px;height:28px;border-radius:50%;background:var(--accent-dim);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0 }
</style>
