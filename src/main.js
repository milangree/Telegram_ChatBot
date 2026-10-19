import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { useToast } from './stores/toast'
import { useWebSocket } from './stores/websocket'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// ── 全局错误处理 ──────────────────────────────────────────────────────────
// Vue 组件错误
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]', info, err)
  const toast = useToast()
  toast.error('页面出现错误，请刷新重试')
}

// 未捕获的运行时错误
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error || event.message)
  const toast = useToast()
  toast.error('发生未知错误，请刷新重试')
})

// 未处理的 Promise rejection
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason)
  const toast = useToast()
  toast.error('操作失败，请重试')
})

// ── WebSocket 连接 ────────────────────────────────────────────────────────
const ws = useWebSocket()
ws.connect()

app.mount('#app')
