// ── SQL review store ────────────────────────────────────

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DbConnection, SqlJob } from '@/types'

export const useSqlStore = defineStore('sql', () => {
  // ── State ──────────────────────────────────────────────
  const databases = ref<DbConnection[]>([])
  const jobs = ref<SqlJob[]>([])
  const reviewMode = ref(true)
  const reviewToken = ref('')
  const currentSection = ref<'pending' | 'executed' | 'rejected' | 'failed'>('pending')
  const selectedJob = ref<SqlJob | null>(null)
  const dbFilter = ref('')
  const rejectTargetId = ref<string | null>(null)
  const rejectReason = ref('')
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // ── Computed ───────────────────────────────────────────
  const filteredJobs = computed(() => {
    let list = jobs.value
    if (dbFilter.value) list = list.filter(j => j.dbId === dbFilter.value)
    if (currentSection.value) list = list.filter(j => j.status === currentSection.value)
    return list
  })

  const pendingCount = computed(() => {
    let list = jobs.value
    if (dbFilter.value) list = list.filter(j => j.dbId === dbFilter.value)
    return list.filter(j => j.status === 'pending').length
  })

  const dbPendingCounts = computed(() => {
    const counts: Record<string, number> = {}
    jobs.value.forEach(j => {
      if (j.status === 'pending' && j.dbId) {
        counts[j.dbId] = (counts[j.dbId] || 0) + 1
      }
    })
    return counts
  })

  // ── Actions ────────────────────────────────────────────
  async function loadInfo() {
    try {
      const res = await fetch('/api/sql/review-mode')
      const data = await res.json()
      reviewMode.value = data.reviewMode
      reviewToken.value = data.token || ''
    } catch { /* */ }
  }

  async function loadDatabases() {
    try {
      const res = await fetch('/api/db')
      databases.value = await res.json()
    } catch { databases.value = [] }
  }

  async function refreshDatabases() {
    try {
      const res = await fetch('/api/db/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        databases.value = data.databases || []
      }
    } catch { /* */ }
  }

  async function loadJobs() {
    try {
      const res = await fetch('/api/sql/queue')
      const data = await res.json()
      jobs.value = data.jobs || []
      reviewMode.value = data.reviewMode
    } catch { jobs.value = [] }
  }

  async function toggleReviewMode() {
    const newMode = !reviewMode.value
    const res = await fetch('/api/sql/review-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newMode, token: reviewToken.value }),
    })
    const data = await res.json()
    if (data.ok) reviewMode.value = newMode
    else throw new Error(data.error || 'Token error')
  }

  async function approveJob(id: string) {
    const res = await fetch(`/api/sql/approve/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: reviewToken.value }),
    })
    const data = await res.json()
    if (data.ok) {
      const job = jobs.value.find(j => j.id === id)
      if (job) { job.status = 'executed'; (job as any).result = data.result }
      if (selectedJob.value?.id === id) selectedJob.value = job ?? null
    }
    return data
  }

  async function rejectJob(id: string) {
    const reason = rejectReason.value
    rejectTargetId.value = null
    rejectReason.value = ''
    await fetch(`/api/sql/reject/${id}`, {
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
  function setDbFilter(id: string) {
    dbFilter.value = id
    localStorage.setItem('sql-db-filter', id)
  }
  function openRejectModal(id: string) {
    rejectTargetId.value = id
    rejectReason.value = ''
  }
  function closeRejectModal() { rejectTargetId.value = null }

  function startPolling() {
    loadJobs()
    pollTimer = setInterval(loadJobs, 3000)
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  async function init() {
    const savedDb = localStorage.getItem('sql-db-filter')
    if (savedDb) dbFilter.value = savedDb
    await loadInfo()
    await loadDatabases()
    startPolling()
  }

  return {
    databases, jobs, reviewMode, reviewToken, currentSection, selectedJob,
    dbFilter, rejectTargetId, rejectReason,
    filteredJobs, pendingCount, dbPendingCounts,
    loadInfo, loadDatabases, refreshDatabases, loadJobs,
    toggleReviewMode, approveJob, rejectJob, selectJob,
    setSection, setDbFilter, openRejectModal, closeRejectModal,
    startPolling, stopPolling, init,
  }
})
