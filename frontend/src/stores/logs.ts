// ── Log viewer store(按当前项目作用域) ────────────────────
//   数据源 = GET /api/logs?project=<id>;SSE 随项目重连;切换项目自动重置。

import { apiFetch, apiJson } from '@/utils/api-fetch'
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { LogEntry } from '@/types'
import { useSSE } from '@/composables/useSSE'
import { useProjectsStore } from './projects'

export const useLogStore = defineStore('logs', () => {
  const projects = useProjectsStore()

  // ── State ──────────────────────────────────────────────
  const logs = ref<LogEntry[]>([])
  const tabs = ref<Record<string, { name: string; content: string; lines: number }>>({})
  const activeFile = ref<string | null>(null)
  const activityMap = ref<Record<string, number>>({})
  const autoScroll = ref<Record<string, boolean>>({})
  const portStatusMap = ref<Record<number, boolean>>({})
  const newContentMap = ref<Record<string, boolean>>({})   // per-file new content flag
  const savedAnsi = localStorage.getItem('log-ansi')
  const ansiMode = ref<'strip' | 'raw' | 'color'>(
    savedAnsi === 'raw' || savedAnsi === 'color' ? savedAnsi : 'strip'
  )
  const showConfig = ref(false)
  /** per-file 新日志闪烁定时器:亮 T 后 3 秒自动灭 */
  const contentTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // ── Computed ───────────────────────────────────────────
  const filteredLogs = computed(() => logs.value)
  const hasTabs = computed(() => Object.keys(tabs.value).length > 0)

  // ── SSE ────────────────────────────────────────────────
  const { connected, onLog, onPortStatus, connect } = useSSE()

  onLog(msg => {
    // 消息带 project 时,只处理当前项目的文件(双保险,服务端已按项目过滤)
    if (msg.project && msg.project !== projects.currentId) return
    activityMap.value[msg.file] = msg.timestamp || Date.now()
    if (msg.content) {
      // changed=true 才是真正的增量新日志,初始加载的 content 不触发 T 图标
      // 正在打开(activeFile)看着的文件不闪 T;其余文件收到新日志 → T 亮 3 秒自动灭
      if (msg.changed && msg.file !== activeFile.value) {
        newContentMap.value[msg.file] = true
        armContentTimer(msg.file)
      }
      if (tabs.value[msg.file]) {
        appendContent(msg.file, msg.content)
      }
    }
  })

  onPortStatus(ports => {
    Object.assign(portStatusMap.value, ports)
  })

  /** T 亮起后 3 秒自动灭(3 秒内持续有新日志 → 每轮重置,直到安静 3 秒) */
  function armContentTimer(fp: string) {
    const prev = contentTimers.get(fp)
    if (prev) clearTimeout(prev)
    contentTimers.set(fp, setTimeout(() => {
      newContentMap.value[fp] = false
      contentTimers.delete(fp)
    }, 3000))
  }
  /** 文件被打开/关闭/重置时清定时器(已读,无需再灭) */
  function clearContentTimer(fp?: string) {
    if (fp) {
      const t = contentTimers.get(fp)
      if (t) { clearTimeout(t); contentTimers.delete(fp) }
    } else {
      for (const t of contentTimers.values()) clearTimeout(t)
      contentTimers.clear()
    }
  }

  // ── 项目切换:重置打开文件,重连 SSE,重拉列表 ──────────────
  function resetAll() {
    clearContentTimer()
    logs.value = []
    tabs.value = {}
    activeFile.value = null
    activityMap.value = {}
    autoScroll.value = {}
    newContentMap.value = {}
  }

  watch(() => projects.currentId, async (id) => {
    resetAll()
    if (id) connect(id)
    await loadLogs()
  })

  // ── Actions ────────────────────────────────────────────
  async function loadLogs() {
    if (!projects.currentId) { logs.value = []; return }
    try {
      const data = await apiJson<{ data: LogEntry[] }>(`/api/logs?project=${encodeURIComponent(projects.currentId)}`)
      logs.value = data.data || []
      // 同步端口状态(SSE 未覆盖前先用列表初始 alive 值)
      for (const log of logs.value) {
        if (log.port !== undefined && log.port !== null) {
          portStatusMap.value[log.port] = log.alive ?? false
        }
      }
    } catch { logs.value = [] }
  }

  async function openFile(fp: string, name: string) {
    if (!projects.currentId) return
    // 清除 new-content 标记:用户点开即视为已读(同时取消 3 秒自动灭定时器)
    newContentMap.value[fp] = false
    clearContentTimer(fp)
    if (tabs.value[fp]) {
      activeFile.value = fp
      return
    }
    tabs.value[fp] = { name, content: '', lines: 0 }
    autoScroll.value[fp] = true
    activeFile.value = fp

    try {
      const q = `project=${encodeURIComponent(projects.currentId)}&file=${encodeURIComponent(fp)}`
      const data = await apiJson<{ data?: { content?: string }; content?: string }>(`/api/log/content?${q}`)
      const content = data?.data?.content ?? data?.content ?? ''
      if (content) {
        tabs.value[fp].content = content
        tabs.value[fp].lines = (content.match(/\n/g) || []).length
      }
    } catch { /* ignore */ }
  }

  function closeTab(fp: string) {
    delete tabs.value[fp]
    delete autoScroll.value[fp]
    clearContentTimer(fp)
    const keys = Object.keys(tabs.value)
    if (keys.length) activeFile.value = keys[keys.length - 1]
    else activeFile.value = null
  }

  function appendContent(fp: string, text: string) {
    if (!tabs.value[fp]) return
    tabs.value[fp].content += text
    tabs.value[fp].lines = (tabs.value[fp].content.match(/\n/g) || []).length
  }

  async function clearLog(fp: string) {
    if (!projects.currentId) return
    try {
      await apiFetch(`/api/log/clear?project=${encodeURIComponent(projects.currentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fp }),
      })
    } catch { /* ignore */ }
    if (tabs.value[fp]) {
      tabs.value[fp].content = ''
      tabs.value[fp].lines = 0
    }
  }

  async function reloadContent(fp: string) {
    if (!projects.currentId) return
    try {
      const q = `project=${encodeURIComponent(projects.currentId)}&file=${encodeURIComponent(fp)}`
      const data = await apiJson<{ data?: { content?: string }; content?: string }>(`/api/log/content?${q}`)
      const content = data?.data?.content ?? data?.content ?? ''
      if (content && tabs.value[fp]) {
        tabs.value[fp].content = content
        tabs.value[fp].lines = (content.match(/\n/g) || []).length
      }
    } catch { /* ignore */ }
  }

  /** 初始化:项目未就绪则等 watch,就绪直接拉列表 + 连 SSE */
  async function refreshAll() {
    if (projects.currentId) {
      connect(projects.currentId)
      await loadLogs()
    }
  }

  function clearNewContent(fp: string) {
    newContentMap.value[fp] = false
  }

  function cycleAnsi() {
    const modes: Array<'strip' | 'raw' | 'color'> = ['strip', 'raw', 'color']
    const idx = modes.indexOf(ansiMode.value)
    ansiMode.value = modes[(idx + 1) % 3]
    localStorage.setItem('log-ansi', ansiMode.value)
    // 重载所有打开的 Tab(换渲染模式)
    Object.keys(tabs.value).forEach(fp => reloadContent(fp))
  }

  return {
    logs, tabs, activeFile, activityMap,
    autoScroll, portStatusMap, newContentMap, ansiMode, showConfig,
    filteredLogs, hasTabs, connected,
    loadLogs, openFile, closeTab, appendContent, clearLog,
    reloadContent, refreshAll, clearNewContent, cycleAnsi, resetAll,
  }
})
