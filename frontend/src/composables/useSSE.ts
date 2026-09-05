// ── SSE connection composable(带 JWT ?token=,可选 ?project= 过滤) ──
//   EventSource 无法自定义 Header,后端 authMiddleware 支持 query token。

import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { SseMessage, PortStatusMessage } from '@/types'

export function useSSE() {
  const connected = ref(false)
  let es: EventSource | null = null

  type LogHandler = (msg: SseMessage) => void
  type PortHandler = (ports: Record<number, boolean>) => void

  const logHandlers: LogHandler[] = []
  const portHandlers: PortHandler[] = []

  function onLog(fn: LogHandler) { logHandlers.push(fn) }
  function onPortStatus(fn: PortHandler) { portHandlers.push(fn) }

  function connect(projectId?: string) {
    if (es) es.close()
    const auth = useAuthStore()
    const params = new URLSearchParams()
    if (auth.token) params.set('token', auth.token)
    if (projectId) params.set('project', projectId)
    const qs = params.toString()
    es = new EventSource(qs ? `/api/stream?${qs}` : '/api/stream')
    es.onopen = () => { connected.value = true }
    es.onerror = () => { connected.value = false }
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      // Batch log messages (array)
      if (Array.isArray(data)) {
        for (const d of data) {
          if (d.file) logHandlers.forEach(fn => fn(d as SseMessage))
        }
        return
      }
      // Port status message
      if (data.type === 'port-status' && data.ports) {
        portHandlers.forEach(fn => fn(data.ports))
        return
      }
      // Single log message (backward compat)
      if (data.file) logHandlers.forEach(fn => fn(data as SseMessage))
    }
  }

  // Connect immediately instead of waiting for onMounted
  // (this composable is called inside a Pinia store, not a component)
  connect()

  return { connected, onLog, onPortStatus, connect }
}
