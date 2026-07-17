<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      ref="overlayRef"
      class="modal-overlay app-dialog-overlay"
      tabindex="-1"
      @click.self="onCancel"
    >
      <div class="modal-card card app-dialog" role="dialog" aria-modal="true" :aria-label="state.title || 'dialog'">
        <div class="app-dialog-header">
          <h3 class="app-dialog-title">{{ state.title || defaultTitle }}</h3>
          <button class="btn-icon" type="button" :title="t('app.close')" @click="onCancel">
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <div class="app-dialog-body">
          <p v-if="state.message" class="app-dialog-message">{{ state.message }}</p>
          <input
            v-if="state.mode === 'prompt'"
            ref="inputRef"
            v-model="state.inputValue"
            class="app-dialog-input"
            :placeholder="state.placeholder || t('common.inputPlaceholder')"
            @keydown.enter.prevent="onSubmit"
          />
        </div>

        <div class="app-dialog-actions">
          <button
            v-if="state.mode !== 'alert'"
            type="button"
            class="btn-ghost"
            @click="onCancel"
          >
            {{ state.cancelText || t('common.cancel') }}
          </button>
          <button
            type="button"
            :class="state.danger ? 'btn-danger' : 'btn-primary'"
            @click="onSubmit"
          >
            {{ state.confirmText || (state.mode === 'alert' ? t('common.ok') : t('common.confirm')) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDialog } from '../stores/dialog.js'
import { useI18nStore } from '../stores/i18n'

const i18n = useI18nStore()
const t = i18n.t
const dialog = useDialog()
const state = dialog.state
const inputRef = ref(null)
const overlayRef = ref(null)

const defaultTitle = computed(() => {
  if (state.mode === 'confirm') return t('common.confirm')
  if (state.mode === 'prompt') return t('common.input')
  return t('common.notice')
})

function onCancel() {
  dialog.cancel()
}

function onSubmit() {
  dialog.submit()
}

function onDocKeydown(e) {
  if (!state.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
  }
}

watch(() => state.open, async (open) => {
  if (!open) {
    document.removeEventListener('keydown', onDocKeydown)
    return
  }
  document.addEventListener('keydown', onDocKeydown)
  await nextTick()
  if (state.mode === 'prompt' && inputRef.value) {
    inputRef.value.focus()
    inputRef.value.select?.()
  } else if (overlayRef.value) {
    overlayRef.value.focus()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<style scoped>
.app-dialog-overlay{z-index:2000;outline:none}
.app-dialog{
  width:min(440px,100%);
  padding:0;
  overflow:hidden;
}
.app-dialog-header{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 18px 0;
}
.app-dialog-title{
  margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em;
}
.app-dialog-body{padding:12px 18px 6px}
.app-dialog-message{
  margin:0;
  white-space:pre-wrap;
  color:var(--text2);
  font-size:13px;
  line-height:1.6;
}
.app-dialog-input{margin-top:12px}
.app-dialog-actions{
  display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;
  padding:14px 18px 18px;
}
.app-dialog-actions .btn-danger{
  background:var(--danger);
  color:#fff;
}
</style>
