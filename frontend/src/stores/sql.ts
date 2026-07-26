// ── SQL review store ────────────────────────────────────
// 职责：管理数据库连接、SQL 任务队列、查询历史、抽屉状态

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSoundNotification } from '@/composables/useSoundNotification'
import type { DbConnection, SqlJob, SqlHistoryEntry } from '@/types'

/** API 基础 fetch 包装 */
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, opts)
    return await res.json() as T
  } catch {
    return null
  }
}

export const useSqlStore = defineStore('sql', () => {
  // ── 组合 composables ──────────────────────────────────
  const sound = useSoundNotification()

  // ── State ──────────────────────────────────────────────
  const databases = ref<DbConnection[]>([])
  const jobs = ref<SqlJob[]>([])
  const reviewMode = ref(true)
  const reviewToken = ref('')
  const currentSection = ref<'pending' | 'executed' | 'rejected' | 'failed'>('pending')
  const selectedJob = ref<SqlJob | null>(null)
  const currentDbGroup = ref('proj')
  const rejectTargetId = ref<string | null>(null)
  const rejectReason = ref('')
  const historyList = ref<SqlHistoryEntry[]>([])
  const selectedHistory = ref<SqlHistoryEntry | null>(null)
  const showHistoryDrawer = ref(false)
  const showApprovalDrawer = ref(false)

  // 定时器
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let historyPollTimer: ReturnType<typeof setInterval> | null = null

  // ── Computed ───────────────────────────────────────────

  /** 所有不重复的数据库分组名 */
  const dbGroups = computed(() =>
    Array.from(new Set(databases.value.map(d => d.group).filter(Boolean) as string[]))
  )

  /** 当前分组下的数据库 ID 集合 */
  const dbIdsInGroup = computed(() => {
    if (!currentDbGroup.value) return databases.value.map(d => d.id)
    return databases.value.filter(d => d.group === currentDbGroup.value).map(d => d.id)
  })

  /** 按分组 + 状态筛选后的任务列表 */
  const filteredJobs = computed(() => {
    const groupFiltered = currentDbGroup.value && dbIdsInGroup.value.length
      ? jobs.value.filter(j => dbIdsInGroup.value.includes(j.dbId))
      : jobs.value
    return currentSection.value
      ? groupFiltered.filter(j => j.status === currentSection.value)
      : groupFiltered
  })

  /** 当前分组下的待审批数量 */
  const pendingCount = computed(() => {
    let list = jobs.value
    if (currentDbGroup.value && dbIdsInGroup.value.length) {
      list = list.filter(j => dbIdsInGroup.value.includes(j.dbId))
    }
    return list.filter(j => j.status === 'pending').length
  })

  /** 每个数据库的待审批数量（用于 DbHealthList 角标） */
  const dbPendingCounts = computed(() => {
    const counts: Record<string, number> = {}
    jobs.value.forEach(j => {
      if (j.status === 'pending' && j.dbId) {
        counts[j.dbId] = (counts[j.dbId] || 0) + 1
      }
    })
    return counts
  })

  /** 当前分组下的数据库列表 */
  const currentDatabases = computed(() =>
    !currentDbGroup.value
      ? databases.value
      : databases.value.filter(d => d.group === currentDbGroup.value)
  )

  /** 已审批/已执行/失败的记录（审批抽屉用） */
  const reviewedJobs = computed(() =>
    jobs.value.filter(j => j.status === 'executed' || j.status === 'rejected' || j.status === 'failed')
  )

  // ── Data fetching ──────────────────────────────────────

  async function loadInfo() {
    const data = await apiFetch<{ reviewMode: boolean; token: string }>('/api/sql/review-mode')
    if (data) {
      reviewMode.value = data.reviewMode
      reviewToken.value = data.token || ''
    }
  }

  async function loadDatabases() {
    const data = await apiFetch<DbConnection[]>('/api/db')
    databases.value = data ?? []
  }

  async function refreshDatabases() {
    const data = await apiFetch<{ ok: boolean; databases?: DbConnection[] }>('/api/db/refresh', { method: 'POST' })
    if (data?.ok && data.databases) {
      databases.value = data.databases
    }
  }

  async function loadJobs() {
    const data = await apiFetch<{ jobs?: SqlJob[]; reviewMode: boolean }>('/api/sql/queue')
    if (!data) { jobs.value = []; return }

    const newJobs = (data.jobs || []) as SqlJob[]
    const newPending = newJobs.filter(j => j.status === 'pending').length

    // 有等待审批的任务且评审模式开 → 持续响铃
    if (newPending > 0 && data.reviewMode) {
      sound.startBeeping()
    } else {
      sound.stopBeeping()
    }

    jobs.value = newJobs
    reviewMode.value = data.reviewMode
  }

  async function loadHistory() {
    const data = await apiFetch<{ ok: boolean; list: SqlHistoryEntry[] }>('/api/sql/history')
    if (data?.ok) historyList.value = data.list
  }

  // ── Actions ────────────────────────────────────────────

  async function toggleReviewMode() {
    const data = await apiFetch<{ ok: boolean; reviewMode: boolean }>('/api/sql/review-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !reviewMode.value, token: reviewToken.value }),
    })
    if (data?.ok) reviewMode.value = data.reviewMode
    else throw new Error('Failed to toggle review mode')
  }

  async function approveJob(id: string) {
    const data = await apiFetch<{ ok: boolean; result?: unknown; error?: string }>(`/api/sql/approve/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: reviewToken.value }),
    })
    if (data?.ok) {
      const job = jobs.value.find(j => j.id === id)
      if (job) { (job as any).result = data.result; job.status = 'executed' }
      if (selectedJob.value?.id === id) selectedJob.value = job ?? null
    }
    return data
  }

  async function rejectJob(id: string) {
    const reason = rejectReason.value
    rejectTargetId.value = null
    rejectReason.value = ''
    await apiFetch(`/api/sql/reject/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, token: reviewToken.value }),
    })
    const job = jobs.value.find(j => j.id === id)
    if (job) { job.status = 'rejected'; job.rejectReason = reason }
    if (selectedJob.value?.id === id) selectedJob.value = job ?? null
  }

  function selectJob(job: SqlJob | null) { selectedJob.value = job }
  function setSection(s: typeof currentSection.value) { currentSection.value = s }

  function setDbGroup(group: string) {
    currentDbGroup.value = group
    localStorage.setItem('sql-db-group', group)
  }

  function selectHistory(entry: SqlHistoryEntry | null) {
    selectedHistory.value = entry
  }

  function openRejectModal(id: string) {
    rejectTargetId.value = id
    rejectReason.value = ''
  }

  function closeRejectModal() { rejectTargetId.value = null }

  // ── Polling ────────────────────────────────────────────

  function startPolling() {
    loadJobs()
    pollTimer = setInterval(loadJobs, 3000)
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    stopHistoryPolling()
  }

  function startHistoryPolling() {
    loadHistory()
    if (historyPollTimer) clearInterval(historyPollTimer)
    historyPollTimer = setInterval(loadHistory, 3000)
  }

  function stopHistoryPolling() {
    if (historyPollTimer) { clearInterval(historyPollTimer); historyPollTimer = null }
  }

  // ── Drawers ────────────────────────────────────────────

  function toggleHistoryDrawer() {
    showHistoryDrawer.value = !showHistoryDrawer.value
    if (showHistoryDrawer.value) startHistoryPolling()
    else stopHistoryPolling()
  }

  function toggleApprovalDrawer() {
    showApprovalDrawer.value = !showApprovalDrawer.value
  }

  // ── Init ───────────────────────────────────────────────

  async function init() {
    const saved = localStorage.getItem('sql-db-group')
    if (saved) currentDbGroup.value = saved
    await loadInfo()
    await loadDatabases()
    startPolling()
  }

  return {
    // 状态
    databases, jobs, reviewMode, reviewToken,
    currentSection, selectedJob, currentDbGroup,
    rejectTargetId, rejectReason,
    historyList, selectedHistory,
    showHistoryDrawer, showApprovalDrawer,
    // 声音（代理到 composable）
    soundEnabled: sound.soundEnabled,
    isRinging: sound.isRinging,
    toggleSound: sound.toggleSound,
    // computed
    dbGroups, dbIdsInGroup, currentDatabases, reviewedJobs,
    filteredJobs, pendingCount, dbPendingCounts,
    // actions
    loadInfo, loadDatabases, refreshDatabases, loadJobs,
    toggleReviewMode, approveJob, rejectJob, selectJob,
    setSection, setDbGroup, selectHistory,
    openRejectModal, closeRejectModal,
    // polling
    startPolling, stopPolling,
    loadHistory,
    // drawers
    toggleHistoryDrawer, toggleApprovalDrawer,
    // init
    init,
  }
})
