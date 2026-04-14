<template>
  <svg
    v-if="icon"
    class="app-icon"
    :class="[`app-icon--${name}`]"
    :style="iconStyle"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    :stroke-width="strokeWidth"
    aria-hidden="true"
  >
    <template v-if="name === 'logo' || name === 'bot'">
      <rect x="7" y="8" width="10" height="8" rx="2" />
      <path d="M12 4v4" />
      <path d="M9 4h6" />
      <circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 15h5" />
      <path d="M7 11H5" />
      <path d="M19 11h-2" />
    </template>

    <template v-else-if="name === 'dashboard' || name === 'stats'">
      <path d="M4 19h16" />
      <rect x="5" y="11" width="3" height="6" rx="1" />
      <rect x="10.5" y="7" width="3" height="10" rx="1" />
      <rect x="16" y="4" width="3" height="13" rx="1" />
    </template>

    <template v-else-if="name === 'conversations' || name === 'message'">
      <path d="M5 7.5A3.5 3.5 0 0 1 8.5 4h7A3.5 3.5 0 0 1 19 7.5v5A3.5 3.5 0 0 1 15.5 16H10l-4 4v-4.5A3.5 3.5 0 0 1 5 12.5z" />
      <path d="M8.5 9h7" />
      <path d="M8.5 12h4.5" />
    </template>

    <template v-else-if="name === 'users'">
      <circle cx="9" cy="9" r="2.5" />
      <circle cx="16" cy="10" r="2" />
      <path d="M4.5 18a4.5 4.5 0 0 1 9 0" />
      <path d="M13.5 18a3.5 3.5 0 0 1 5-2.8" />
    </template>

    <template v-else-if="name === 'whitelist'">
      <path d="M12 3l7 3v5c0 4.5-2.8 7.4-7 10-4.2-2.6-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </template>

    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.5" />
      <path d="M12 19v2.5" />
      <path d="M2.5 12H5" />
      <path d="M19 12h2.5" />
      <path d="M5.3 5.3l1.8 1.8" />
      <path d="M16.9 16.9l1.8 1.8" />
      <path d="M18.7 5.3l-1.8 1.8" />
      <path d="M7.1 16.9l-1.8 1.8" />
    </template>

    <template v-else-if="name === 'profile'">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19a6 6 0 0 1 12 0" />
    </template>

    <template v-else-if="name === 'refresh'">
      <path d="M20 4.5V8h-3.5" />
      <path d="M20 8a8.5 8.5 0 0 0-14.8-2.8" />
      <path d="M4 19.5V16h3.5" />
      <path d="M4 16a8.5 8.5 0 0 0 14.8 2.8" />
    </template>

    <template v-else-if="name === 'logout'">
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <path d="M13 8l5 4-5 4" />
      <path d="M18 12H9" />
    </template>

    <template v-else-if="name === 'menu'">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </template>

    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </template>

    <template v-else-if="name === 'light'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5" />
      <path d="M12 19v2.5" />
      <path d="M4.9 4.9l1.8 1.8" />
      <path d="M17.3 17.3l1.8 1.8" />
      <path d="M2.5 12H5" />
      <path d="M19 12h2.5" />
      <path d="M4.9 19.1l1.8-1.8" />
      <path d="M17.3 6.7l1.8-1.8" />
    </template>

    <template v-else-if="name === 'dark'">
      <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5z" />
    </template>

    <template v-else-if="name === 'system'">
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M8 19h8" />
      <path d="M10 16v3" />
      <path d="M14 16v3" />
    </template>

    <template v-else-if="name === 'block'">
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 8.5l7 7" />
    </template>

    <template v-else-if="name === 'unblock'">
      <circle cx="12" cy="12" r="8" />
      <path d="M9 12l2 2 4-4" />
    </template>

    <template v-else-if="name === 'delete'">
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M8 7l.7 11h6.6L16 7" />
      <path d="M10 10v5" />
      <path d="M14 10v5" />
    </template>

    <template v-else-if="name === 'add'">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </template>

    <template v-else-if="name === 'quick'">
      <path d="M13 3L5 14h5l-1 7 8-11h-5z" />
    </template>

    <template v-else-if="name === 'webhook' || name === 'link'">
      <path d="M10.5 13.5l3-3" />
      <path d="M8 16a3 3 0 0 1 0-4.2l2.2-2.2a3 3 0 0 1 4.2 0" />
      <path d="M16 8a3 3 0 0 1 0 4.2l-2.2 2.2a3 3 0 0 1-4.2 0" />
    </template>

    <template v-else-if="name === 'verify' || name === 'lock'">
      <rect x="6.5" y="10.5" width="11" height="8" rx="2" />
      <path d="M9 10.5V8.5a3 3 0 0 1 6 0v2" />
    </template>

    <template v-else-if="name === 'feature'">
      <path d="M13 3L5 14h5l-1 7 8-11h-5z" />
    </template>

    <template v-else-if="name === 'welcome'">
      <path d="M4 12a8 8 0 0 0 16 0" />
      <path d="M8 10h.01" />
      <path d="M16 10h.01" />
      <path d="M9 14c1 .9 2 .9 3 .9s2 0 3-.9" />
    </template>

    <template v-else-if="name === 'storage'">
      <ellipse cx="12" cy="6" rx="6.5" ry="2.5" />
      <path d="M5.5 6v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V6" />
      <path d="M5.5 12v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-6" />
    </template>

    <template v-else-if="name === 'today' || name === 'calendar'">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
      <path d="M4 9h16" />
    </template>

    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.2-4.2" />
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  size: {
    type: [Number, String],
    default: 18,
  },
  strokeWidth: {
    type: [Number, String],
    default: 1.8,
  },
})

const icon = computed(() => Boolean(props.name))

const iconStyle = computed(() => {
  const size = typeof props.size === 'number' ? `${props.size}px` : props.size
  return {
    width: size,
    height: size,
  }
})
</script>

<style scoped>
.app-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
  overflow: visible;
}
</style>
