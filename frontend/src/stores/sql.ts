// ── SQL review store(按当前项目作用域) ────────────────────
// 职责:管理数据库连接、SQL 任务队列、查询历史、抽屉状态。
// 所有项目级接口都带 ?project=<id>;切换项目自动重载。

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { apiFetch } from '@/utils/api-fetch'
import { useProjectsStore } from './projects'
import { useSoundNotification } from '@/composables/useSoundNotification'
import type { DbConnection, SqlJob, SqlHistoryEntry } from '@/types'

export const useSqlStore = defineStore('sql', () => {
  const projects = useProjectsStore()

  // ── 组合 composables ──────────────────────────────────
  const sound = useSoundNotification()

  // ── State ──────────────────────────────────────────────
  const databases = ref<DbConnection[]>([])
  const jobs = ref<SqlJob[]>([])
  const reviewMode = ref(true)
  const reviewToken = ref('')
  const currentSection = ref<'pending' | 'executed' | 'rejected' | 'failed'>('pending')
  const selectedJob = ref<SqlJob | null>(null)
  const rejectTargetId = ref<string | null>(null)
  const rejectReason = ref('')
  const historyList = ref<SqlHistoryEntry[]>([])
  const selectedHistory = ref<SqlHistoryEntry | null>(null)
  const showHistoryDrawer = ref(false)
  const showApprovalDrawer = ref(false)

  // 定时器
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let historyPollTimer: ReturnType<typeof setInterval> | null = null
  let active = false   // 是否正在轮询(在 /sql 页内)

  // ── Computed ───────────────────────────────────────────
  /** 连接列表即当前项目的全部连接(无分组概念) */
  const currentDatabases = computed(() => databases.value)

  /** 任务列表(当前 section 状态筛选;不再按数据库分组) */
  const filteredJobs = computed(() => {
    if (!currentSection.value) return jobs.value
    return jobs.value.filter(j => j.status === currentSection.value)
  })

  /** 待审批数量 */
  const pendingCount = computed(() =>
    jobs.value.filter(j => j.status === 'pending').length
  )

  /** 每个数据库的待审批数量(DbHealthList 角标) */
  const dbPendingCounts = computed(() => {
    const counts: Record<string, number> = {}
    jobs.value.forEach(j => {
      if (j.status === 'pending' && j.dbId) {
        counts[j.dbId] = (counts[j.dbId] || 0) + 1
      }
    })
    return counts
  })

  /** 已审批/已执行/失败(审批抽屉) */
  const reviewedJobs = computed(() =>
    jobs.value.filter(j => j.status === 'executed' || j.status === 'rejected' || j.status === 'failed')
  )

  // ── URL 辅助 ──────────────────────────────────────────
  function qs(): string {
    return projects.currentId ? `project=${encodeURIComponent(projects.currentId)}` : ''
  }

  // ── Data fetching ──────────────────────────────────────
  async function loadInfo() {
    try {
      const res = await apiFetch('/api/sql/review-mode')
      const data = await res.json()
      if (data) {
        reviewMode.value = data.reviewMode
        reviewToken.value = data.token || ''
      }
    } catch { /* ignore */ }
  }

  async function loadDatabases() {
    if (!projects.currentId) { databases.value = []; return }
    try {
      const res = await apiFetch(`/api/db?${qs()}`)
      const data = await res.json()
      databases.value = data?.data ?? []
    } catch { databases.value = [] }
  }

  async function refreshDatabases() {
    if (!projects.currentId) return
    try {
      const res = await apiFetch(`/api/db/refresh?${qs()}`, { method: 'POST' })
      const data = await res.json()
      if (data?.ok) databases.value = data?.data ?? []
    } catch { /* ignore */ }
  }

  async function loadJobs() {
    if (!projects.currentId) { jobs.value = []; return }
    try {
      const res = await apiFetch(`/api/sql/queue?${qs()}`)
      const data = await res.json()
      if (!data) { jobs.value = []; return }
      const newJobs = (data.jobs || []) as SqlJob[]
      const newPending = newJobs.filter(j => j.status === 'pending').length

      // 有待审批且评审模式开 → 持续响铃
      if (newPending > 0 && data.reviewMode) sound.startBeeping()
      else sound.stopBeeping()

      jobs.value = newJobs
      reviewMode.value = data.reviewMode
    } catch { /* ignore */ }
  }

  async function loadHistory() {
    if (!projects.currentId) { historyList.value = []; return }
    try {
      const res = await apiFetch(`/api/sql/history?${qs()}`)
      const data = await res.json()
      if (data?.ok) historyList.value = data.list || []
    } catch { historyList.value = [] }
  }

  // ── Actions ────────────────────────────────────────────
  async function toggleReviewMode() {
    const res = await apiFetch('/api/sql/review-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !reviewMode.value, token: reviewToken.value }),
    })
    const data = await res.json()
    if (data?.ok) reviewMode.value = data.reviewMode
    else throw new Error(data?.error || 'Failed to toggle review mode')
  }

  async function approveJob(id: string) {
    if (!projects.currentId) return null
    const res = await apiFetch(`/api/sql/approve/${id}?${qs()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: reviewToken.value }),
    })
    const data = await res.json()
    if (data?.ok) {
      const job = jobs.value.find(j => j.id === id)
      if (job) { (job as any).result = data.result; job.status = 'executed' }
      if (selectedJob.value?.id === id) selectedJob.value = job ?? null
    }
    return data
  }

  async function rejectJob(id: string) {
    if (!projects.currentId) return
    const reason = rejectReason.value
    rejectTargetId.value = null
    rejectReason.value = ''
    try {
      await apiFetch(`/api/sql/reject/${id}?${qs()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, token: reviewToken.value }),
      })
    } catch { /* ignore */ }
    const job = jobs.value.find(j => j.id === id)
    if (job) { job.status = 'rejected'; job.rejectReason = reason }
    if (selectedJob.value?.id === id) selectedJob.value = job ?? null
  }

  function selectJob(job: SqlJob | null) { selectedJob.value = job }
  function setSection(s: typeof currentSection.value) { currentSection.value = s }

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
    active = true
    loadDatabases()
    loadJobs()
    if (!pollTimer) pollTimer = setInterval(loadJobs, 3000)
  }

  function stopPolling() {
    active = false
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

  // ── 项目切换:清空状态 + 重载(仅当在 /sql 页内活跃) ─────
  watch(() => projects.currentId, () => {
    jobs.value = []
    selectedJob.value = null
    historyList.value = []
    selectedHistory.value = null
    if (active) {
      loadDatabases()
      loadJobs()
    }
  })

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
    await loadInfo()
    startPolling()
  }

  return {
    // 状态
    databases, jobs, reviewMode, reviewToken,
    currentSection, selectedJob,
    rejectTargetId, rejectReason,
    historyList, selectedHistory,
    showHistoryDrawer, showApprovalDrawer,
    // 声音(代理到 composable)
    soundEnabled: sound.soundEnabled,
    isRinging: sound.isRinging,
    toggleSound: sound.toggleSound,
    // computed
    currentDatabases, reviewedJobs, filteredJobs, pendingCount, dbPendingCounts,
    // actions
    loadInfo, loadDatabases, refreshDatabases, loadJobs,
    toggleReviewMode, approveJob, rejectJob, selectJob,
    setSection, selectHistory,
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
