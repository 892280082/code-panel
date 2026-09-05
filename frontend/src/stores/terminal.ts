// ── 终端会话 Store ───────────────────────────────────────
//   管理浮动终端窗口(命令终端 + tmux 持久化会话)。
//   sessions 是内存态:页面刷新后消失(命令终端随之关闭);
//   tmux 会话本身在服务器常驻,drawer「会话」Tab 刷新列表后点一下即重连。
//
//   kind:
//     'cmd'   命令终端(端口池 9002-9011,页面级生命周期,关闭=杀掉进程)
//     'tmux'  tmux 持久化终端(端口池 9020-9029,关闭窗口只断开 ttyd 接入,
//             tmux 会话不杀,随时可重连;彻底删除走 deleteTmuxSession)

import { apiFetch } from '@/utils/api-fetch'
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
  kind: 'cmd' | 'tmux'
  tmuxSession?: string // tmux 物理会话名(p_<projectId>_<name>),作会话唯一 key
  tmuxDesc?: string
}

export const useTerminalStore = defineStore('terminal', () => {
  const sessions = reactive<Map<number, TerminalSession>>(new Map())
  const drawerOpen = ref(false)

  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }
  function closeDrawer() { drawerOpen.value = false }

  /** 读取保存的位置(越界自动重置到可视区,和面板一致) */
  function readSavedPos(port: number): { x: number; y: number } {
    let x = 0, y = 0
    try {
      const saved = JSON.parse(localStorage.getItem(`cmd-terminal-pos-${port}`) || 'null')
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        const panelW = Math.min(900, window.innerWidth - 48)
        const panelH = Math.min(580, window.innerHeight - 48)
        const maxX = Math.max(0, (window.innerWidth - panelW) / 2)
        const maxY = Math.max(0, (window.innerHeight - panelH) / 2)
        x = Math.min(Math.max(saved.x, -maxX), maxX)
        y = Math.min(Math.max(saved.y, -maxY), maxY)
      }
    } catch {}
    return { x, y }
  }

  async function createSession(label: string, command: string, cwd: string) {
    try {
      const res = await apiFetch('/api/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, command, cwd }),
      })
      const data = await res.json()
      if (data.ok) {
        const { port } = data.data
        const pos = readSavedPos(port)
        sessions.set(port, { port, label, command, cwd, minimized: false, x: pos.x, y: pos.y, kind: 'cmd' })
      } else {
        console.error('Failed to create session:', data.error)
      }
    } catch (err) {
      console.error('Session creation error:', err)
    }
  }

  // ── Tmux:连接已有 tmux 会话(持久化终端) ─────────────
  //   ttyd 只是接入通道,断开/刷新后 tmux session 常驻,可随时重连。
  //   fullName 是物理会话名(p_<projectId>_<name>);displayName 是展示名(去前缀);
  //   projectId 用于接口作用域。已连接同会话 → 直接恢复显示。
  async function attachTmux(
    fullName: string, displayName: string, projectId: string, description?: string,
  ): Promise<number | null> {
    for (const [port, s] of sessions) {
      if (s.kind === 'tmux' && s.tmuxSession === fullName) {
        s.minimized = false
        drawerOpen.value = false
        return port
      }
    }

    try {
      const res = await apiFetch('/api/terminal/tmux/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, name: fullName }),
      })
      const data = await res.json()
      if (!data.ok) {
        console.error('Tmux attach failed:', data.error)
        return null
      }
      const { port } = data.data
      const sessionName: string = data.data.sessionName || fullName
      const pos = readSavedPos(port)
      const desc = description || ''
      const pretty = desc ? `${displayName} — ${desc}` : displayName
      sessions.set(port, {
        port,
        label: pretty,
        command: '',
        cwd: '',
        minimized: false,
        x: pos.x,
        y: pos.y,
        kind: 'tmux',
        tmuxSession: sessionName,
        tmuxDesc: desc,
      })
      drawerOpen.value = false
      return port
    } catch (err) {
      console.error('Tmux attach error:', err)
      return null
    }
  }

  /** 关闭窗口:tmux → 只断开 ttyd 接入(不杀会话);cmd → 杀掉命令终端 */
  async function closeSession(port: number) {
    const s = sessions.get(port)
    try {
      if (s?.kind === 'tmux') {
        await apiFetch(`/api/terminal/tmux-sessions/${port}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/terminal/sessions/${port}`, { method: 'DELETE' })
      }
    } catch { /* ignore */ }
    sessions.delete(port)
  }

  /** 彻底删除 tmux 会话(断开所有接入 + kill tmux session + 清备注 + 关窗口) */
  async function deleteTmuxSession(fullName: string, projectId: string) {
    // 关闭该会话所有已连接窗口(每个只 detach)
    for (const [port, s] of sessions) {
      if (s.kind === 'tmux' && s.tmuxSession === fullName) {
        try { await apiFetch(`/api/terminal/tmux-sessions/${port}`, { method: 'DELETE' }) } catch { /* ignore */ }
        sessions.delete(port)
      }
    }
    try {
      await apiFetch(`/api/terminal/tmux/${encodeURIComponent(fullName)}?project=${encodeURIComponent(projectId)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
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

  /** 页面卸载/登出时清理:tmux 只 detach(保会话);cmd 杀掉 */
  function cleanupAll() {
    for (const [port, s] of sessions) {
      const url = s.kind === 'tmux'
        ? `/api/terminal/tmux-sessions/${port}`
        : `/api/terminal/sessions/${port}`
      apiFetch(url, { method: 'DELETE' }).catch(() => {})
    }
    sessions.clear()
  }

  return {
    sessions, drawerOpen,
    toggleDrawer, closeDrawer,
    createSession, closeSession,
    minimizeSession, restoreSession, cleanupAll,
    attachTmux, deleteTmuxSession
  }
})
