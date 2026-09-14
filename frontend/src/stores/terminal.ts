// ── 终端会话 Store ───────────────────────────────────────
//   管理浮动终端窗口(命令终端 + tmux 持久化会话)。
//   kind:
//     'cmd'   命令终端(端口池 9002-9011,页面级生命周期)
//     'tmux'  tmux 持久化终端(端口池 9020-9029,断开只杀 ttyd 接入,tmux 会话不杀)
//
//   持久化(对齐 code-server):窗口「位置 + 打开/最小化状态」存 localStorage,
//   页面刷新后自动恢复 —— tmux 重连,cmd 若服务端会话仍在则重新接回。
//
//   🔒 项目隔离(纯浏览器,不碰后端):锁关 = 全局清单,所有项目共享全部
//   终端窗口;锁开 = 每个项目在 localStorage 里记住自己打开的终端
//   (cp:term:proj:<id>),切项目时清单外的窗口自动断开(tmux 会话不死,
//   切回重开)。允许 A/B 项目各自打开同一终端(attach 复用同一 tmux 会话)。

import { apiFetch, apiJson } from '@/utils/api-fetch'
import type { TerminalServerSession } from '@/types'
import { raise } from '@/utils/z-layer'
import { slotPos } from '@/utils/viewport-layout'
import { useProjectsStore } from './projects'
import { defineStore } from 'pinia'
import { ref, reactive, watch } from 'vue'

export interface TerminalSession {
  port: number
  label: string
  command: string
  cwd: string
  minimized: boolean
  maximized: boolean        // 全屏铺满视口（头部 □ 切换）
  x: number                 // 居中偏移量（见 TerminalPanel：translate(-50% + x, -50% + y)）
  y: number
  zIndex: number            // 层级：与 Repo Browser 共用全局计数器，点击置顶
  kind: 'cmd' | 'tmux'
  tmuxSession?: string // tmux 物理会话名(p_<projectId>_<name>),作会话唯一 key
  tmuxProject?: string // tmux 会话归属项目 id(标题栏「复制屏幕」抓屏要用)
  tmuxDesc?: string
  /** 一次性启停会话(Apps 启动/停止,keepShell=false):大窗展示 2s → 自动最小化到左上角 chip → 20s 未放大自动关闭 */
  oneshot?: boolean
  /** 用户已点击 chip 放大(激活看日志):此后不再自动关闭,手动 ✕ */
  activated?: boolean
}

/** localStorage 持久化的窗口描述(不含运行态 port/zIndex) */
interface SavedWindow {
  kind: 'cmd' | 'tmux'
  label: string
  command: string
  cwd: string
  tmuxSession?: string
  tmuxProject?: string
  minimized: boolean
  x: number
  y: number
}

const PERSIST_KEY = 'cp:terminal-windows'
/** 🔒 隔离锁状态(全局;1=按项目隔离) */
const ISO_KEY = 'cp:term-isolated'
/** 锁开时每项目一份窗口清单:每个项目记住自己打开的终端 */
const projListKey = (id: string) => `cp:term:proj:${id}`

/** 窗口身份:tmux 用物理会话名唯一;cmd 用 label+command(与恢复匹配规则一致) */
function windowKey(w: Pick<SavedWindow, 'kind' | 'tmuxSession' | 'label' | 'command'>): string {
  return w.kind === 'tmux' ? `t:${w.tmuxSession}` : `c:${w.label}|${w.command}`
}

export const useTerminalStore = defineStore('terminal', () => {
  const projectsStore = useProjectsStore()
  const sessions = reactive<Map<number, TerminalSession>>(new Map())
  const drawerOpen = ref(false)

  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }
  function closeDrawer() { drawerOpen.value = false }

  /** 窗口落位:per-port 记忆优先(该窗口刷新后回原位,越界钳回可视区);
   *  新窗口(无记忆)→ 按已占槽位找空位落座(当前尺寸记过位用档案槽,
   *  否则向右阶梯错开)—— 第 1 个/第 2 个…各就各位 */
  function readSavedPos(port: number): { x: number; y: number } {
    try {
      const saved = JSON.parse(localStorage.getItem(`cmd-terminal-pos-${port}`) || 'null')
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        const panelW = Math.min(900, window.innerWidth - 48)
        const panelH = Math.min(580, window.innerHeight - 48)
        const maxX = Math.max(0, (window.innerWidth - panelW) / 2)
        const maxY = Math.max(0, (window.innerHeight - panelH) / 2)
        return {
          x: Math.min(Math.max(saved.x, -maxX), maxX),
          y: Math.min(Math.max(saved.y, -maxY), maxY),
        }
      }
    } catch { /* 无记忆/坏数据 → 落到槽位 */ }
    const taken = [...sessions.values()].map(s => ({ x: s.x, y: s.y }))
    return slotPos(sessions.size, taken)
  }

  // ── 🔒 项目隔离锁 ────────────────────────────────────────
  //   关(默认):终端窗口全项目共享(全局清单 PERSIST_KEY)
  //   开:每个项目一份清单(projListKey),切项目时清单外窗口断开、
  //      清单内补开;允许 A/B 项目各自打开同一终端(同 tmux 复用同端口)。
  const isolated = ref(localStorage.getItem(ISO_KEY) === '1')

  /** 生效清单 key:锁开且有当前项目 → 项目清单;否则全局清单 */
  function activeListKey(): string {
    const pid = projectsStore.currentId
    return isolated.value && pid ? projListKey(pid) : PERSIST_KEY
  }

  /** 运行时会话 → 持久化窗口描述 */
  function toSaved(s: TerminalSession): SavedWindow {
    return {
      kind: s.kind, label: s.label, command: s.command, cwd: s.cwd,
      tmuxSession: s.tmuxSession, tmuxProject: s.tmuxProject,
      minimized: s.minimized, x: s.x, y: s.y,
    }
  }

  function readSavedWindowsFrom(key: string): SavedWindow[] {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }

  /** 把当前屏幕窗口集写入指定清单(调用方决定写全局还是某项目) */
  function persistWindowsTo(key: string): void {
    const list: SavedWindow[] = []
    for (const s of sessions.values()) list.push(toSaved(s))
    try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* ignore */ }
  }

  function persistWindows() {
    persistWindowsTo(activeListKey())
  }

  /** 关窗口 = 从全局 + 所有项目清单里移除该条目(关了就是关了,切项目不许复活)。
   *  项目清单按 key 前缀扫 localStorage(不依赖项目列表加载;已删项目的残留清单也清到) */
  function removeFromAllLists(s: TerminalSession): void {
    const k = windowKey(s)
    const keys = [PERSIST_KEY]
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('cp:term:proj:')) keys.push(key)
    }
    for (const key of keys) {
      const list = readSavedWindowsFrom(key)
      const next = list.filter(x => windowKey(x) !== k)
      if (next.length !== list.length) {
        try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
      }
    }
  }

  /** 🔒 切换隔离锁。
   *  开:项目清单为空 → 收编屏幕现有窗口为该项目清单(首次接管,不丢窗口);
   *      清单非空 → 按清单重建屏幕(清单外的断开)。
   *  关:屏幕窗口原样保留,写回全局清单(各项目清单保留,下次开锁还在)。 */
  function setIsolated(v: boolean): void {
    if (isolated.value === v) return
    isolated.value = v
    localStorage.setItem(ISO_KEY, v ? '1' : '0')
    const pid = projectsStore.currentId
    if (!v) { persistWindowsTo(PERSIST_KEY); return }
    if (!pid) return
    if (readSavedWindowsFrom(projListKey(pid)).length === 0) persistWindowsTo(projListKey(pid))
    else void applyProjectScope(pid)
  }

  /** 🔒 锁开 + 项目切换:让屏幕窗口集合 = 目标项目清单。
   *  清单外断开(tmux 只断接入,会话不死;cmd 杀进程),清单内补开。
   *  全程绕开 persistWindows(会话集合收敛中,中途写清单会截短目标清单),
   *  结束后统一写一次。scopeSeq 防竞态:连续快速切项目,旧重建自动作废。 */
  let scopeSeq = 0
  async function applyProjectScope(pid: string): Promise<void> {
    const seq = ++scopeSeq
    const want = readSavedWindowsFrom(projListKey(pid))
    const wantKeys = new Set(want.map(windowKey))
    for (const [port, s] of [...sessions.entries()]) {
      if (!wantKeys.has(windowKey(s))) await detachPort(port)
      if (seq !== scopeSeq) return   // 期间又切了项目 → 放弃本次(新一轮已接管)
    }
    let serverSessions: TerminalServerSession[] = []
    try {
      const d = await apiJson<{ data: TerminalServerSession[] }>('/api/terminal/sessions')
      serverSessions = d?.data || []
    } catch { /* ignore */ }
    for (const w of want) {
      const exists = [...sessions.values()].some(s => windowKey(s) === windowKey(w))
      if (!exists) await reopenSavedWindow(w, serverSessions, { persist: false })
      if (seq !== scopeSeq) return
    }
    persistWindows()
  }

  // 锁开时切换项目:切走前把屏幕快照进旧项目清单,再按新项目清单重建屏幕
  watch(() => projectsStore.currentId, (pid, old) => {
    if (!isolated.value) return
    if (old) persistWindowsTo(projListKey(old))
    if (pid) void applyProjectScope(pid)
  })

  /** 重开一条持久化窗口记录(tmux 重连 / cmd 复用服务端活会话)。
   *  opts.persist=false:批量恢复中途不写清单(全量派生会截短清单),
   *  由调用方收尾统一 persist 一次。 */
  async function reopenSavedWindow(
    w: SavedWindow, serverSessions: TerminalServerSession[], opts?: { persist?: boolean },
  ): Promise<void> {
    if (w.kind === 'tmux' && w.tmuxSession) {
      const pid = w.tmuxProject || projectsStore.currentId || ''
      if (!pid) return
      // label 形如 "名 — 描述",拆回展示名/描述(无则退化 label)
      const sep = w.label.indexOf(' — ')
      const display = sep === -1 ? w.label : w.label.slice(0, sep)
      const desc = sep === -1 ? '' : w.label.slice(sep + 3)
      const port = await attachTmux(w.tmuxSession, display, pid, desc, opts)
      if (port !== null) {
        const s = sessions.get(port)
        if (s) { s.x = w.x; s.y = w.y; s.minimized = !!w.minimized }
      }
    } else if (w.kind === 'cmd' && w.command) {
      // 复用服务端还活着的会话(不重启进程),找不到则跳过
      const hit = serverSessions.find(ss => ss.label === w.label && ss.command === w.command)
      if (!hit || !hit.port) return
      if (sessions.has(hit.port)) return
      sessions.set(hit.port, {
        port: hit.port,
        label: w.label,
        command: w.command,
        cwd: w.cwd || '',
        minimized: !!w.minimized,
        maximized: false,
        x: w.x,
        y: w.y,
        zIndex: raise(),
        kind: 'cmd',
      })
      if (opts?.persist !== false) persistWindows()
    }
  }

  /** 刷新后恢复:重开上次打开的窗口(记住位置 + 最小化状态)。
   *  🔒 锁开时读当前项目清单(无当前项目则退化全局清单,
   *  项目列表随后加载完时 watch currentId 会再按项目清单收敛一次)。 */
  async function restorePersisted() {
    const saved = readSavedWindowsFrom(activeListKey())
    if (!saved.length) return
    // 服务端当前还活着的 cmd 会话(刷新前若没清理,它们还在)
    let serverSessions: TerminalServerSession[] = []
    try {
      const data = await apiJson<{ data: TerminalServerSession[] }>('/api/terminal/sessions')
      serverSessions = data?.data || []
    } catch { /* ignore */ }

    for (const w of saved) {
      await reopenSavedWindow(w, serverSessions, { persist: false })
    }
    persistWindows()
  }

  async function createSession(
    label: string, command: string, cwd: string, keepShell = true, opts?: { persist?: boolean },
  ) {
    try {
      const data = await apiJson<{ data: { port: number } }>('/api/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, command, cwd, keepShell }),
      })
      const { port } = data.data
      const pos = readSavedPos(port)
      const oneshot = !keepShell
      sessions.set(port, {
        port, label, command, cwd,
        minimized: false, maximized: false,
        x: pos.x, y: pos.y,
        zIndex: raise(),
        kind: 'cmd',
        oneshot,
        activated: false,
      })
      if (opts?.persist !== false) persistWindows()
      if (!keepShell) {
        // keepShell=false 一次性(Apps 启停):大窗展示 2s → 自动最小化到左上角 chip → 20s 未放大自动关闭
        watchAutoClose(port)
        scheduleOneshotCollapse(port)
      }
    } catch (err) {
      console.error('Session creation error:', err)
    }
  }

  // ── 一次性(Apps 启停)生命周期 ──────────────────────────
  //   oneshot 会话默认 minimized=false(大窗展示);2s 后自动最小化(收起为 chip),
  //   20s 内用户没点击放大(restoreSession→activated) → 自动关闭清理;
  //   用户点击放大后 activated=true,不再自动关闭,可看日志,手动 ✕。
  const lifecycleTimers = new Map<number, { collapse?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>()

  function clearLifecycle(port: number) {
    const t = lifecycleTimers.get(port)
    if (t) {
      if (t.collapse) clearTimeout(t.collapse)
      if (t.close) clearTimeout(t.close)
      lifecycleTimers.delete(port)
    }
  }

  /** 2s 后自动最小化 → 收起为 chip;若已被用户激活(activated)则不再收 */
  function scheduleOneshotCollapse(port: number) {
    clearLifecycle(port)
    const collapse = setTimeout(() => {
      const s = sessions.get(port)
      if (!s || s.activated) return
      s.minimized = true
      persistWindows()
      scheduleOneshotClose(port)   // 收起后开始 20s 倒计时
    }, 2000)
    lifecycleTimers.set(port, { collapse })
  }

  /** 收起(chip)状态挂 20s:期间没被放大(activated) → 自动关闭会话 */
  function scheduleOneshotClose(port: number) {
    const prev = lifecycleTimers.get(port) || {}
    const close = setTimeout(() => {
      const s = sessions.get(port)
      if (!s || s.activated) return   // 已被激活(在看日志) → 不自动关
      closeSession(port)
    }, 20000)
    lifecycleTimers.set(port, { ...prev, close })
  }

  /** 用户点击放大(chip → 大窗)= 激活:取消全部自动收起/关闭 */
  function markActivated(port: number) {
    const s = sessions.get(port)
    if (!s) return
    s.activated = true
    clearLifecycle(port)
    persistWindows()
  }

  /** 一次性会话:服务端 session 消失(命令已执行完)时,自动收起对应窗口 */
  function watchAutoClose(port: number) {
    const timer = setInterval(async () => {
      if (!sessions.has(port)) { clearInterval(timer); return }
      try {
        const d = await apiJson<{ data: TerminalServerSession[] }>('/api/terminal/sessions')
        const list: TerminalServerSession[] = (d && d.data) ? d.data : []
        const alive = list.some(s => s.port === port)
        if (!alive) {
          sessions.delete(port)
          persistWindows()
          clearInterval(timer)
        }
      } catch { /* 网络抖动忽略,下轮再查 */ }
    }, 1200)
  }

  // ── Tmux:连接已有 tmux 会话(持久化终端) ─────────────
  //   ttyd 只是接入通道,断开/刷新后 tmux session 常驻,可随时重连。
  //   fullName 是物理会话名(p_<projectId>_<name>);displayName 是展示名(去前缀);
  //   projectId 用于接口作用域。已连接同会话 → 直接恢复显示。
  async function attachTmux(
    fullName: string, displayName: string, projectId: string, description?: string,
    opts?: { persist?: boolean },
  ): Promise<number | null> {
    for (const [port, s] of sessions) {
      if (s.kind === 'tmux' && s.tmuxSession === fullName) {
        s.minimized = false
        drawerOpen.value = false
        return port
      }
    }

    try {
      const data = await apiJson<{ data: { port: number; sessionName?: string } }>('/api/terminal/tmux/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, name: fullName }),
      })
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
        maximized: false,
        x: pos.x,
        y: pos.y,
        zIndex: raise(),
        kind: 'tmux',
        tmuxSession: sessionName,
        tmuxProject: projectId,
        tmuxDesc: desc,
      })
      if (opts?.persist !== false) persistWindows()
      drawerOpen.value = false
      return port
    } catch (err) {
      console.error('Tmux attach error:', err)
      return null
    }
  }

  /** 关窗口底层:杀服务端接入/进程 + 清运行时与位置记忆。
   *  不写清单(applyProjectScope 批量收敛时调用方自理),也不从清单移除条目。 */
  async function detachPort(port: number): Promise<void> {
    clearLifecycle(port)
    try {
      const s = sessions.get(port)
      if (s?.kind === 'tmux') {
        await apiFetch(`/api/terminal/tmux-sessions/${port}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/terminal/sessions/${port}`, { method: 'DELETE' })
      }
    } catch { /* ignore */ }
    sessions.delete(port)
    // ⭐ 清 per-port 位置记忆:窗口实例没了记忆随走 —— 否则 ttyd 端口
    // 复用时,新开的窗口会顶在旧窗口的位置上,而不是按槽位就座。
    // (刷新恢复走窗口清单里的 x/y,不受影响)
    try { localStorage.removeItem(`cmd-terminal-pos-${port}`) } catch { /* ignore */ }
  }

  /** 关闭窗口:tmux → 只断开 ttyd 接入(不杀会话);cmd → 杀掉命令终端。
   *  同时从全局 + 所有项目清单移除该条目(关了就是关了,切项目不许复活)。 */
  async function closeSession(port: number) {
    const s = sessions.get(port)
    await detachPort(port)
    if (s) removeFromAllLists(s)
    persistWindows()
  }

  /** 彻底删除 tmux 会话(断开所有接入 + kill tmux session + 清备注 + 关窗口) */
  async function deleteTmuxSession(fullName: string, projectId: string) {
    // 关闭该会话所有已连接窗口(每个只 detach)——会话被杀,清单里也不许留
    for (const [port, s] of [...sessions.entries()]) {
      if (s.kind === 'tmux' && s.tmuxSession === fullName) {
        await detachPort(port)
        removeFromAllLists(s)
      }
    }
    try {
      await apiFetch(`/api/terminal/tmux/${encodeURIComponent(fullName)}?project=${encodeURIComponent(projectId)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    persistWindows()
  }

  function minimizeSession(port: number) {
    const s = sessions.get(port)
    if (s) { s.minimized = true; persistWindows() }
  }

  /** 置顶：与 Repo Browser 共用全局计数器，点哪个窗口就把谁放最上层 */
  function bringToFront(port: number) {
    const s = sessions.get(port)
    if (s) s.zIndex = raise()
  }

  function restoreSession(port: number) {
    const s = sessions.get(port)
    if (s) {
      // 一次性会话被放大 = 用户激活看日志 → 取消自动收起/20s 自动关
      if (s.oneshot) markActivated(port)
      s.minimized = false
      drawerOpen.value = false
      bringToFront(port)
      persistWindows()
    }
  }

  /** □ 最大化 / 还原（几何由 TerminalPanel 纯 CSS 控制，不改 x/y → 还原回原位） */
  function toggleMaximizeSession(port: number) {
    const s = sessions.get(port)
    if (s) {
      s.maximized = !s.maximized
      bringToFront(port)
    }
  }

  /** 登出/关闭页面不主动杀终端:cmd 由服务端端口池管理,tmux 常驻。
   *  刷新后由 restorePersisted() 按 localStorage 恢复窗口。 */
  function cleanupAll() {
    persistWindows()
  }

  // ── 抓屏复制弹窗(全局唯一;终端窗口标题栏 ⧉ 与会话列表「复制」共用)──
  //   背景:tmux mouse on 截获网页拖选(Mac 浏览器无 Shift 绕过)、ttyd 无
  //   OSC52 —— 后端 capture-pane 出纯文本是网页远程时唯一可靠复制通道。
  const capTarget = ref<{ fullName: string; label: string; project: string } | null>(null)

  function openCapture(t: { fullName: string; label: string; project: string }) {
    capTarget.value = t
  }
  function closeCapture() {
    capTarget.value = null
  }

  /** 快捷键动作:显示/隐藏全部 tmux 终端窗口(一个都没有时开命令抽屉)。
   *  供两处调用:App.vue 全局热键 + TerminalPanel 注入终端 iframe 的
   *  转发监听(焦点在终端 iframe 里时父窗口收不到按键,必须内也监听) */
  function toggleTmuxVisibility(): void {
    const tmux = [...sessions.values()].filter(s => s.kind === 'tmux')
    if (!tmux.length) { toggleDrawer(); return }
    const anyVisible = tmux.some(s => !s.minimized)
    for (const s of tmux) {
      if (anyVisible) minimizeSession(s.port)
      else if (s.minimized) restoreSession(s.port)
    }
  }

  return {
    sessions, drawerOpen,
    isolated, setIsolated,
    toggleDrawer, closeDrawer,
    createSession, closeSession,
    minimizeSession, restoreSession, cleanupAll,
    attachTmux, deleteTmuxSession,
    bringToFront, toggleMaximizeSession,
    persistWindows, restorePersisted,
    markActivated,
    capTarget, openCapture, closeCapture,
    toggleTmuxVisibility,
  }
})
