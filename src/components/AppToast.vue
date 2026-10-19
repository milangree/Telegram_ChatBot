<template>
  <Teleport to="body">
    <div
      class="toast-stack"
      aria-live="polite"
      aria-relevant="additions"
    >
      <TransitionGroup name="toast">
        <div
          v-for="item in state.items"
          :key="item.id"
          class="toast-item"
          :class="[`toast-${item.type}`, { leaving: item.leaving }]"
          role="status"
        >
          <span
            class="toast-icon"
            aria-hidden="true"
          >
            <AppIcon
              :name="iconOf(item.type)"
              :size="15"
            />
          </span>
          <span class="toast-text">{{ item.message }}</span>
          <button
            class="toast-close btn-icon"
            type="button"
            :title="t('app.close')"
            @click="toast.dismiss(item.id)"
          >
            <AppIcon
              name="close"
              :size="14"
            />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import AppIcon from './AppIcon.vue'
import { useToast } from '../stores/toast.js'
import { useI18nStore } from '../stores/i18n'

const toast = useToast()
const state = toast.state
const i18n = useI18nStore()
const t = i18n.t

function iconOf(type) {
  if (type === 'success') return 'check'
  if (type === 'error') return 'close'
  if (type === 'warn') return 'block'
  return 'conversations'
}
</script>

<style scoped>
.toast-stack{
  position:fixed;
  top:18px;
  right:18px;
  z-index:3000;
  display:flex;
  flex-direction:column;
  gap:10px;
  width:min(360px, calc(100vw - 24px));
  pointer-events:none;
}
.toast-item{
  pointer-events:auto;
  display:flex;
  align-items:flex-start;
  gap:10px;
  padding:12px 12px 12px 14px;
  border-radius:14px;
  border:1px solid var(--border);
  background:var(--bg2);
  box-shadow:0 12px 32px rgba(0,0,0,.22);
  color:var(--text);
  backdrop-filter:blur(14px) saturate(140%);
  -webkit-backdrop-filter:blur(14px) saturate(140%);
}
.toast-success{border-color:rgba(79,190,124,.35)}
.toast-error{border-color:rgba(247,79,79,.35)}
.toast-warn{border-color:rgba(247,164,79,.35)}
.toast-info{border-color:rgba(79,142,247,.35)}
.toast-icon{
  width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  margin-top:1px;
}
.toast-success .toast-icon{background:rgba(79,190,124,.15);color:var(--success)}
.toast-error .toast-icon{background:rgba(247,79,79,.15);color:var(--danger)}
.toast-warn .toast-icon{background:rgba(247,164,79,.15);color:var(--warn)}
.toast-info .toast-icon{background:var(--accent-dim);color:var(--accent)}
.toast-text{
  flex:1;min-width:0;font-size:13px;line-height:1.45;word-break:break-word;padding-top:2px;
}
.toast-close{
  width:28px;height:28px;flex-shrink:0;color:var(--text3);
}
.toast-close:hover{color:var(--text);background:var(--bg3)}
.toast-enter-active,.toast-leave-active{transition:all .2s var(--ease-out)}
.toast-enter-from{opacity:0;transform:translateY(-8px) scale(.98)}
.toast-leave-to{opacity:0;transform:translateY(-6px) scale(.98)}
@media (max-width:768px){
  .toast-stack{top:12px;right:12px;left:12px;width:auto}
}
</style>
