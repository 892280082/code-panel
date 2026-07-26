// ── Log viewer store ─────────────────────────────────────

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppConfig, LogEntry } from '@/types'
import { useSSE } from '@/composables/useSSE'

export const useLogStore = defineStore('logs', () => {
  // ── State ──────────────────────────────────────────────
  const config = ref<AppConfig>({ groups: {}, reviewMode: true })
  const sortedLogs = ref<LogEntry[]>([])
  const currentGroup = ref<string>('')
  const tabs = ref<Record<string, { name: string; content: string; lines: number }>>({})
  const activeFile = ref<string | null>(null)
  const activityMap = ref<Record<string, number>>({})
  const autoScroll = ref<Record<string, boolean>>({})
  const portStatusMap = ref<Record<number, boolean>>({})
  const ansiMode = ref<'strip' | 'raw' | 'color'>(
    (localStorage.getItem('log-ansi') as any) || 'strip'
  )
  const showConfig = ref(false)

  // ── Computed ───────────────────────────────────────────
  const groups = computed(() => Object.keys(config.value.groups || {}))
  const groupNames = computed(() => config.value.groups || {})
  const currentLogs = computed(() => {
    if (!currentGroup.value) return []
    return config.value.groups[currentGroup.value]?.logs || []
  })
  const filteredLogs = computed(() => {
    const groupFiles = new Set(currentLogs.value.map(l => l.file))
    return sortedLogs.value.filter(s => groupFiles.has(s.file))
  })
  const hasTabs = computed(() => Object.keys(tabs.value).length > 0)

  // ── SSE ────────────────────────────────────────────────
  const { connected, onLog, onPortStatus } = useSSE()

  onLog(msg => {
    activityMap.value[msg.file] = msg.timestamp || Date.now()
    if (msg.content && tabs.value[msg.file]) {
      appendContent(msg.file, msg.content)
    }
  })

  onPortStatus(ports => {
    Object.assign(portStatusMap.value, ports)
  })

  // ── Actions ────────────────────────────────────────────
  async function loadConfig() {
    const res = await fetch('/api/config')
    config.value = await res.json()
    // Restore last group
    const saved = localStorage.getItem('log-group')
    if (saved && groups.value.includes(saved)) {
      currentGroup.value = saved
    } else if (groups.value.length) {
      currentGroup.value = groups.value[0]
    }
  }

  async function loadSortedLogs() {
    try {
      const res = await fetch('/api/logs')
      sortedLogs.value = await res.json()
      // Sync port status
      for (const log of sortedLogs.value) {
        if (log.port !== undefined && log.port !== null) {
          portStatusMap.value[log.port] = log.alive ?? false
        }
      }
    } catch { /* ignore */ }
  }

  function setGroup(key: string) {
    currentGroup.value = key
    localStorage.setItem('log-group', key)
  }

  async function openFile(fp: string, name: string) {
    if (tabs.value[fp]) {
      activeFile.value = fp
      return
    }
    tabs.value[fp] = { name, content: '', lines: 0 }
    autoScroll.value[fp] = true
    activeFile.value = fp

    try {
      const res = await fetch(`/api/log/content?file=${encodeURIComponent(fp)}`)
      const data = await res.json()
      if (data.content) {
        tabs.value[fp].content = data.content
        tabs.value[fp].lines = (data.content.match(/\n/g) || []).length
      }
    } catch { /* */ }
  }

  function closeTab(fp: string) {
    delete tabs.value[fp]
    delete autoScroll.value[fp]
    const keys = Object.keys(tabs.value)
    if (keys.length) activeFile.value = keys[keys.length - 1]
    else activeFile.value = null
  }

  function appendContent(fp: string, text: string) {
    if (!tabs.value[fp]) return
    tabs.value[fp].content += text
    tabs.value[fp].lines = (tabs.value[fp].content.match(/\n/g) || []).length
  }

  function clearLog(fp: string) {
    if (!tabs.value[fp]) return
    tabs.value[fp].content = ''
    tabs.value[fp].lines = 0
  }

  async function reloadContent(fp: string) {
    try {
      const res = await fetch(`/api/log/content?file=${encodeURIComponent(fp)}`)
      const data = await res.json()
      if (data.content && tabs.value[fp]) {
        tabs.value[fp].content = data.content
        tabs.value[fp].lines = (data.content.match(/\n/g) || []).length
      }
    } catch { /* */ }
  }

  async function refreshAll() {
    await Promise.all([loadConfig(), loadSortedLogs()])
  }

  async function saveConfig() {
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value),
    })
    await refreshAll()
    showConfig.value = false
  }

  function cycleAnsi() {
    const modes: Array<'strip' | 'raw' | 'color'> = ['strip', 'raw', 'color']
    const idx = modes.indexOf(ansiMode.value)
    ansiMode.value = modes[(idx + 1) % 3]
    localStorage.setItem('log-ansi', ansiMode.value)
    // Reload all open tabs
    Object.keys(tabs.value).forEach(fp => reloadContent(fp))
  }

  return {
    config, sortedLogs, currentGroup, tabs, activeFile, activityMap,
    autoScroll, portStatusMap, ansiMode, showConfig,
    groups, groupNames, currentLogs, filteredLogs, hasTabs, connected,
    loadConfig, loadSortedLogs, setGroup, openFile, closeTab,
    appendContent, clearLog, reloadContent, refreshAll, saveConfig,
    cycleAnsi,
  }
})
