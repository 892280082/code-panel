import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'

export interface TerminalSession {
  port: number
  label: string
  command: string
  cwd: string
  minimized: boolean
  x: number
  y: number
}

export const useTerminalStore = defineStore('terminal', () => {
  const sessions = reactive<Map<number, TerminalSession>>(new Map())
  const drawerOpen = ref(false)

  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }
  function closeDrawer() { drawerOpen.value = false }

  async function createSession(label: string, command: string, cwd: string) {
    try {
      const res = await fetch('/api/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, command, cwd })
      })
      const data = await res.json()
      if (data.ok) {
        const { port } = data.data
        let x = 0, y = 0
        try {
          const saved = JSON.parse(localStorage.getItem(`cmd-terminal-pos-${port}`) || 'null')
          if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
            // 分辨率变化后上次位置可能超出屏幕，越界则重置为居中可见区域
            const panelW = Math.min(900, window.innerWidth - 48)
            const panelH = Math.min(580, window.innerHeight - 48)
            const maxX = Math.max(0, (window.innerWidth - panelW) / 2)
            const maxY = Math.max(0, (window.innerHeight - panelH) / 2)
            x = Math.min(Math.max(saved.x, -maxX), maxX)
            y = Math.min(Math.max(saved.y, -maxY), maxY)
          }
        } catch {}
        sessions.set(port, { port, label, command, cwd, minimized: false, x, y })
      } else {
        console.error('Failed to create session:', data.error)
      }
    } catch (err) {
      console.error('Session creation error:', err)
    }
  }

  async function closeSession(port: number) {
    try {
      await fetch(`/api/terminal/sessions/${port}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    sessions.delete(port)
  }

  function minimizeSession(port: number) {
    const s = sessions.get(port)
    if (s) s.minimized = true
  }

  function restoreSession(port: number) {
    const s = sessions.get(port)
    if (s) {
      s.minimized = false
      drawerOpen.value = false
    }
  }

  function cleanupAll() {
    for (const port of sessions.keys()) {
      fetch(`/api/terminal/sessions/${port}`, { method: 'DELETE' }).catch(() => {})
    }
    sessions.clear()
  }

  return {
    sessions, drawerOpen,
    toggleDrawer, closeDrawer,
    createSession, closeSession,
    minimizeSession, restoreSession, cleanupAll
  }
})
