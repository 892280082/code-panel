// ── 终端会话 Store ───────────────────────────────────────
//   管理浮动终端窗口(命令终端 + tmux 持久化会话)。
//   kind:
//     'cmd'   命令终端(端口池 9002-9011,页面级生命周期)
//     'tmux'  tmux 持久化终端(端口池 9020-9029,断开只杀 ttyd 接入,tmux 会话不杀)
//
//   持久化(对齐 code-server):窗口「位置 + 打开/最小化状态」存 localStorage,
//   页面刷新后自动恢复 —— tmux 重连,cmd 若服务端会话仍在则重新接回。
//
//   🌐 项目归属与视角(2026-09-14 归一化,纯浏览器不碰后端):
//     · 归属单一字段 proj —— 创建时盖章(cmd=当时项目快照 / tmux=会话所属
//       项目),此后不变;持久化按项目分清单 cp:term:proj:<id>(唯一事实源,
//       老全局清单 cp:terminal-windows 仅作首次升级的迁移兜底)。
//     · 默认「项目视角」:只显示归属当前项目的窗口 —— 天然隔离,打不开
//       别的项目的终端;抽屉「🌐」开关临时切「全局视角」看全部(盘点/清理)。
//     · 视角/切项目 = 纯显示过滤(v-show),窗口一旦打开常驻运行:iframe
//       不卸载(cmd 回滚不丢)、进程不杀、tmux 接入不重连。
//     · 清单 upsert 合并写入:恢复失败/未接上的条目永不丢失,只有显式
//       关闭(closeSession/removeFromAllLists)才从清单移除。
//     · 刷新只恢复当前项目的清单(端口池有界);切到别的项目时把该项目
//       清单里未接上的窗口懒补齐(syncProjectWindows)。

import { apiFetch, apiJson } from '@/utils/api-fetch'
import type { TerminalServerSession } from '@/types'
import { raise } from '@/utils/z-layer'
import { slotPos } from '@/utils/viewport-layout'
import { useProjectsStore } from './projects'
import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'

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
  proj?: string             // 🌐 归属项目 id(创建时盖章,唯一归属字段)
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
  proj?: string
  tmuxSession?: string
  tmuxProject?: string
  minimized: boolean
  x: number
  y: number
}

/** 老全局清单(迁移兜底:当前项目还没有自己的清单时读一次) */
const PERSIST_KEY = 'cp:terminal-windows'
/** 🌐 全局视角开关(全局;1=显示所有项目的终端)。默认 0=项目视角(只看本项目) */
const SHOW_ALL_KEY = 'cp:term-show-all'
/** 每项目一份窗口清单(唯一事实源) */
const projListKey = (id: string) => `cp:term:proj:${id}`

/** 窗口身份:tmux 用物理会话名唯一(前缀已含项目);cmd 用 归属+label+command ——
 *  必须带归属:两个项目各开一个裸终端(label=终端,command='')长得一模一样,
 *  不带归属会互相顶替(懒补齐误判"已在运行"、清单互相覆盖)。 */
function windowKey(w: Pick<SavedWindow, 'kind' | 'tmuxSession' | 'label' | 'command' | 'proj'>): string {
  return w.kind === 'tmux' ? `t:${w.tmuxSession}` : `c:${w.proj || ''}|${w.label}|${w.command}`
}

/** 从 tmux 物理会话名 p_<projectId>_<name> 解析归属项目 id(老数据兜底) */
function pidFromTmuxName(name: string): string | undefined {
  const m = /^p_([A-Za-z0-9-]+)_/.exec(name)
  return m ? m[1] : undefined
}

export const useTerminalStore = defineStore('terminal', () => {
  const projectsStore = useProjectsStore()
  const sessions = reactive<Map<number, TerminalSession>>(new Map())
  const drawerOpen = ref(false)

  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }
  function closeDrawer() { drawerOpen.value = false }

  // ── 🌐 项目视角 / 全局视角 ────────────────────────────────
  //   (2026-09-14 语义反转:原「🔒隔离锁」默认全局共享、开=隔离 → 现在
  //    默认就是项目隔离,开关只在「看全部」时打开;旧开关值作废重置)
  try { localStorage.removeItem('cp:term-isolated') } catch { /* 一次性迁移 */ }
  const showAll = ref(localStorage.getItem(SHOW_ALL_KEY) === '1')

  /** 归属 = 唯一字段 proj(tmux 在 attach 时、cmd 在创建时盖章) */
  function ownerOf(s: Pick<TerminalSession, 'proj'>): string | undefined {
    return s.proj || undefined
  }

  /** 当前视角是否显示该窗口(纯显示过滤,窗口本身常驻运行) */
  function inView(s: TerminalSession): boolean {
    if (showAll.value) return true
    const pid = projectsStore.currentId
    if (!pid) return true            // 无当前项目(极端初始态)→ 全显示,避免空屏
    return ownerOf(s) === pid
  }

  /** 当前视角可见的会话条目([port, session]) */
  const visibleEntries = computed(() =>
    [...sessions.entries()].filter(([, s]) => inView(s)),
  )

  function visibleList(): TerminalSession[] {
    return visibleEntries.value.map(([, s]) => s)
  }

  /** 归属当前项目的条目(无论视角开关 —— 启停反馈 chip 等项目内语义用) */
  const projectEntries = computed(() => {
    const pid = projectsStore.currentId
    if (!pid) return [...sessions.entries()]
    return [...sessions.entries()].filter(([, s]) => ownerOf(s) === pid)
  })

  /** 归属项目名(全局视角窗口徽标用);解析不出返回空串 */
  function projNameOf(s: TerminalSession): string {
    const pid = ownerOf(s)
    if (!pid) return ''
    return projectsStore.projects.find(p => p.id === pid)?.name || ''
  }

  /** 窗口徽章是否显示:全局视角,或无当前项目的兜底全显(否则分不清是谁的窗口) */
  function showProjChip(s: TerminalSession): boolean {
    return (showAll.value || !projectsStore.currentId) && !!projNameOf(s)
  }

  /** 🌐 切换视角。纯显示过滤,不动任何运行中会话(不重连/不杀进程)。 */
  function setShowAll(v: boolean): void {
    if (showAll.value === v) return
    showAll.value = v
    try { localStorage.setItem(SHOW_ALL_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }

  /** 窗口落位:per-port 记忆优先(该窗口刷新后回原位,越界钳回可视区);
   *  新窗口(无记忆)→ 在「当前视角可见」的窗口里找空位落座(含最小化
   *  chip 的窗口也占位,避免落座即重叠)—— 本项目第 1 个窗口永远从
   *  左上角起,不被别的项目的窗口顶走。 */
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
    const vis = visibleList()
    return slotPos(vis.length, vis.map(s => ({ x: s.x, y: s.y })))
  }

  /** 运行时会话 → 持久化窗口描述 */
  function toSaved(s: TerminalSession): SavedWindow {
    return {
      kind: s.kind, label: s.label, command: s.command, cwd: s.cwd, proj: s.proj,
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

  /** 读某项目的清单并补归属:老版本(隔离锁时期)写的条目没有 proj,按清单 key 补上,
   *  保证 windowKey(含归属)与运行时窗口可比。 */
  function readProjList(pid: string): SavedWindow[] {
    return readSavedWindowsFrom(projListKey(pid)).map(w => ({ ...w, proj: w.proj || pid }))
  }

  /** 持久化 = 按归属 upsert 进各项目清单(原位更新 + 追加新增)。
   *  绝不截短:清单里有、运行时没有的条目(恢复失败/懒补未到)原样保留,
   *  只有显式关闭(removeFromAllLists)才移除 —— 恢复失败永不丢窗口。 */
  function persistWindows(): void {
    const byProj = new Map<string, SavedWindow[]>()
    for (const s of sessions.values()) {
      const pid = ownerOf(s)
      if (!pid) continue
      const list = byProj.get(pid) || []
      list.push(toSaved(s))
      byProj.set(pid, list)
    }
    try {
      for (const [pid, live] of byProj) {
        const key = projListKey(pid)
        const old = readSavedWindowsFrom(key)
        const liveKeys = new Set(live.map(windowKey))
        const merged = old
          .map(w => (liveKeys.has(windowKey(w)) ? live.find(l => windowKey(l) === windowKey(w))! : w))
        for (const l of live) if (!old.some(o => windowKey(o) === windowKey(l))) merged.push(l)
        localStorage.setItem(key, JSON.stringify(merged))
      }
    } catch { /* ignore */ }
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

  /** 懒补齐:切到某项目时,把该项目清单里「还没接上」的窗口重开(tmux 重连/
   *  cmd 复用服务端活会话),保证该项目视角 = 该项目清单全量。 */
  let syncSeq = 0
  async function syncProjectWindows(pid: string): Promise<void> {
    const seq = ++syncSeq
    const want = readProjList(pid)
    const missing = want.filter(
      w => ![...sessions.values()].some(s => windowKey(s) === windowKey(w)),
    )
    if (!missing.length) return
    let serverSessions: TerminalServerSession[] = []
    try {
      const d = await apiJson<{ data: TerminalServerSession[] }>('/api/terminal/sessions')
      serverSessions = d?.data || []
    } catch { /* ignore */ }
    for (const w of missing) {
      if (seq !== syncSeq) return   // 期间又切了项目 → 新一轮接管,本次作废
      await reopenSavedWindow(w, serverSessions, { persist: false })
    }
    persistWindows()
  }

  // 切项目:懒补齐目标项目的清单窗口(旧项目窗口常驻隐藏,不杀不卸)
  watch(() => projectsStore.currentId, (pid) => {
    if (pid) void syncProjectWindows(pid)
  })

  /** 重开一条持久化窗口记录(tmux 重连 / cmd 复用服务端活会话)。 */
  async function reopenSavedWindow(
    w: SavedWindow, serverSessions: TerminalServerSession[], opts?: { persist?: boolean },
  ): Promise<void> {
    if (w.kind === 'tmux' && w.tmuxSession) {
      // 归属:清单字段优先,老数据从 tmuxProject / 物理会话名解析兜底
      const pid = w.proj || w.tmuxProject || pidFromTmuxName(w.tmuxSession) || projectsStore.currentId
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
      // 复用服务端还活着的会话(不重启进程),找不到则跳过(清单条目保留,下次再试)
      const hit = serverSessions.find(ss => ss.label === w.label && ss.command === w.command)
      if (!hit || !hit.port) return
      if (sessions.has(hit.port)) return
      sessions.set(hit.port, {
        port: hit.port,
        label: w.label,
        command: w.command,
        cwd: w.cwd || '',
        proj: w.proj,
        minimized: !!w.minimized,
        maximized: false,
        x: w.x,
        y: w.y,
        zIndex: raise(),
        kind: 'cmd',
      })
    }
    if (opts?.persist !== false) persistWindows()
  }

  /** 刷新后恢复:只恢复「当前项目」的清单(tmux 端口池 9020-9029 有界,
   *  绝不全量恢复所有项目);当前项目没有清单(老用户首次升级)→ 读老全局
   *  清单迁移一次(tmux 从物理会话名解析归属,cmd 归当前项目)。
   *  其他项目的窗口在切到该项目时由 syncProjectWindows 懒补齐。 */
  async function restorePersisted() {
    if (!projectsStore.currentId && !projectsStore.loaded) {
      try { await projectsStore.load() } catch { /* 拿不到项目列表 → 按无项目兜底 */ }
    }
    const pid = projectsStore.currentId
    let saved = pid ? readProjList(pid) : []
    if (!saved.length) {
      saved = readSavedWindowsFrom(PERSIST_KEY).map(w => ({
        ...w,
        proj: w.proj || (w.kind === 'tmux'
          ? (w.tmuxProject || pidFromTmuxName(w.tmuxSession || '') || pid)
          : pid) || undefined,
      }))
    }
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
    // 归属在点击瞬间盖章(不等请求回来 —— 期间切项目不能把窗口归错人)
    const ownerPid = projectsStore.currentId || ''
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
        proj: ownerPid,
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
  //  ttyd 只是接入通道,断开/刷新后 tmux session 常驻,可随时重连。
  //  fullName 是物理会话名(p_<projectId>_<name>);displayName 是展示名(去前缀);
  //  projectId 用于接口作用域,同时盖章为窗口归属 proj。
  //  已连接同会话 → 直接恢复显示。
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
        proj: projectId,
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
   *  仅显式关闭时调用(视角/切项目不调用);不从清单移除条目(closeSession 自理)。 */
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

  /** 快捷键动作:显示/隐藏当前视角的 tmux 终端窗口(一个都没有时开命令抽屉)。
   *  供两处调用:App.vue 全局热键 + TerminalPanel 注入终端 iframe 的
   *  转发监听(焦点在终端 iframe 里时父窗口收不到按键,必须内也监听) */
  function toggleTmuxVisibility(): void {
    const tmux = visibleList().filter(s => s.kind === 'tmux')
    if (!tmux.length) { toggleDrawer(); return }
    const anyVisible = tmux.some(s => !s.minimized)
    for (const s of tmux) {
      if (anyVisible) minimizeSession(s.port)
      else if (s.minimized) restoreSession(s.port)
    }
  }

  return {
    sessions, drawerOpen,
    showAll, setShowAll, inView,
    visibleEntries, visibleList, projectEntries,
    projNameOf, showProjChip,
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
