// src/stores/websocket.js
// WebSocket 连接管理 — 实时推送
import { ref, computed } from 'vue'

const connected = ref(false)
const lastMessage = ref(null)
const reconnectAttempts = ref(0)
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY = 3000

let ws = null
let reconnectTimer = null
let messageHandlers = new Map()

export function useWebSocket() {
  function connect() {
    if (ws && ws.readyState <= 1) return // 已连接或正在连接

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws`

    try {
      ws = new WebSocket(url)

      ws.onopen = () => {
        connected.value = true
        reconnectAttempts.value = 0
        console.log('[WS] 已连接')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          lastMessage.value = data

          // 调用注册的处理器
          const handlers = messageHandlers.get(data.type) || []
          handlers.forEach((handler) => {
            try {
              handler(data)
            } catch (e) {
              console.error('[WS] 处理器错误:', e)
            }
          })
        } catch (e) {
          console.error('[WS] 消息解析错误:', e)
        }
      }

      ws.onclose = () => {
        connected.value = false
        console.log('[WS] 连接已断开')

        // 自动重连
        if (reconnectAttempts.value < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.value++
          console.log(`[WS] ${RECONNECT_DELAY / 1000}秒后重连 (${reconnectAttempts.value}/${MAX_RECONNECT_ATTEMPTS})`)
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY)
        }
      }

      ws.onerror = (error) => {
        console.error('[WS] 连接错误:', error)
      }
    } catch (e) {
      console.error('[WS] 连接失败:', e)
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected.value = false
  }

  function onMessage(type, handler) {
    if (!messageHandlers.has(type)) {
      messageHandlers.set(type, [])
    }
    messageHandlers.get(type).push(handler)

    // 返回取消函数
    return () => {
      const handlers = messageHandlers.get(type) || []
      const index = handlers.indexOf(handler)
      if (index >= 0) handlers.splice(index, 1)
    }
  }

  function send(data) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(data))
    }
  }

  return {
    connected: computed(() => connected.value),
    lastMessage: computed(() => lastMessage.value),
    connect,
    disconnect,
    onMessage,
    send,
  }
}

export default useWebSocket
