// ── Git diff viewer store ────────────────────────────────

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { apiFetch } from '@/utils/api-fetch'

export interface GitRepo {
  id: number
  name: string
  path: string
  notes: string
}

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion'
  content: string
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface RepoDiff {
  repoId: number
  repoName: string
  repoPath: string
  branch: string
  error?: string
  stat: string
  files: FileDiff[]
}

// ── Shared helpers (used by both desktop & mobile views) ──

export function gitPullStatusIcon(status: string): string {
  return { pulled: '↓', 'up-to-date': '✓', conflict: '✗', error: '✗', 'no-remote': '○' }[status] || '?'
}

export function gitFormatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ── Types ────────────────────────────────────────────────

export interface RepoSummary {
  repoId: number
  repoName: string
  branch: string
  error?: string
  clean: boolean
  fileCount: number
  additions: number
  deletions: number
}

export interface PullResult {
  repoId: number
  repoName: string
  branch: string
  status: 'pulled' | 'up-to-date' | 'conflict' | 'error' | 'no-remote'
  message: string
  pulledCount?: number
}

export interface CommitEntry {
  hash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
}

export interface DayGroup {
  date: string
  commits: CommitEntry[]
}

export interface RepoLog {
  repoId: number
  repoName: string
  branch: string
  error?: string
  totalCommits: number
  dayGroups: DayGroup[]
}

export const useGitStore = defineStore('git', () => {
  const repos = ref<GitRepo[]>([])
  const groupList = ref<string[]>([])
  const currentGroup = ref<string>('')
  const summaries = ref<Record<number, RepoSummary>>({})
  const diffResult = ref<RepoDiff | null>(null)
  const showStaged = ref(false)
  const loading = ref(false)
  const expandedRepos = ref<Set<number>>(new Set())
  const expandedFiles = ref<Set<string>>(new Set())
  const showAddRepo = ref(false)
  const selectedFile = ref<string | null>(null)
  const viewMode = ref<'diff' | 'source'>('diff')
  const fileSource = ref<string>('')
  const sourceLoading = ref(false)

  // ── Pull state ─────────────────────────────────────────
  const pulling = ref(false)
  const pullResults = ref<PullResult[]>([])

  // ── Log state ──────────────────────────────────────────
  const logResult = ref<RepoLog | null>(null)
  const logLoading = ref(false)
  const logRepoId = ref<number | null>(null)
  const repoViewMode = ref<'diff' | 'log'>('diff')

  // ── Actions ────────────────────────────────────────────

  async function loadGroups() {
    try {
      const res = await apiFetch('/api/config')
      const data = await res.json()
      groupList.value = Object.keys(data.groups || {})
      const saved = localStorage.getItem('git-group')
      if (saved && groupList.value.includes(saved)) {
        currentGroup.value = saved
      } else {
        currentGroup.value = ''
      }
    } catch { groupList.value = [] }
  }

  async function setGroup(g: string) {
    currentGroup.value = g
    localStorage.setItem('git-group', g)
    await loadRepos()
    await loadAllSummaries()
  }

  async function loadRepos() {
    try {
      const gid = currentGroup.value ? `?group=${encodeURIComponent(currentGroup.value)}` : ''
      const res = await apiFetch(`/api/git/repos${gid}`)
      repos.value = await res.json()
    } catch { repos.value = [] }
  }

  async function loadAllSummaries() {
    // Load summary for all repos in parallel
    const results = await Promise.allSettled(
      repos.value.map(async r => {
        const res = await apiFetch(`/api/git/summary/${r.id}?staged=${showStaged.value}`)
        const data = await res.json()
        summaries.value[r.id] = data
        return data
      })
    )
  }

  async function selectRepo(id: number) {
    const wasExpanded = expandedRepos.value.has(id)
    if (wasExpanded) {
      expandedRepos.value.delete(id)
    } else {
      expandedRepos.value.add(id)
      diffResult.value = null
      selectedFile.value = null
      loading.value = true
      try {
        const staged = showStaged.value ? '&staged=true' : ''
        const res = await apiFetch(`/api/git/diff/${id}?${staged}`)
        const data = await res.json()
        if (data.ok) diffResult.value = data as RepoDiff
      } catch { diffResult.value = null }
      finally { loading.value = false }
    }
    expandedRepos.value = new Set(expandedRepos.value) // trigger reactivity
  }

  function selectFile(filePath: string) {
    const wasOpen = expandedFiles.value.has(filePath)
    if (wasOpen) {
      expandedFiles.value.delete(filePath)
      selectedFile.value = null
    } else {
      expandedFiles.value.add(filePath)
      selectedFile.value = filePath
      viewMode.value = 'diff'  // reset to diff when selecting new file
    }
    expandedFiles.value = new Set(expandedFiles.value)
  }

  async function loadFileSource(repoId: number, filePath: string) {
    sourceLoading.value = true
    try {
      const res = await apiFetch(`/api/git/source/${repoId}?file=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (data.ok) fileSource.value = data.content
    } catch { fileSource.value = '' }
    finally { sourceLoading.value = false }
  }

  function toggleViewMode() {
    viewMode.value = viewMode.value === 'diff' ? 'source' : 'diff'
  }

  // Keyboard navigation: always select, never toggle
  function navigateToFile(filePath: string) {
    expandedFiles.value.add(filePath)
    selectedFile.value = filePath
    expandedFiles.value = new Set(expandedFiles.value)
  }

  function collapseRepo(id: number) {
    expandedRepos.value.delete(id)
    expandedRepos.value = new Set(expandedRepos.value)
    diffResult.value = null
    selectedFile.value = null
    expandedFiles.value = new Set()
  }

  async function addRepo(name: string, repoPath: string, notes?: string, group?: string) {
    const res = await apiFetch('/api/git/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, repoPath, notes, group }),
    })
    const data = await res.json()
    if (data.ok) {
      await loadRepos()
      await loadAllSummaries()
      showAddRepo.value = false
    } else {
      throw new Error(data.error)
    }
  }

  async function removeRepo(id: number) {
    await apiFetch(`/api/git/repos/${id}`, { method: 'DELETE' })
    expandedRepos.value.delete(id)
    await loadRepos()
  }

  async function refresh() {
    await loadAllSummaries()
    // Also refresh expanded repo's full diff
    for (const id of expandedRepos.value) {
      const staged = showStaged.value ? '&staged=true' : ''
      const res = await apiFetch(`/api/git/diff/${id}?${staged}`)
      const data = await res.json()
      if (data.ok) diffResult.value = data as RepoDiff
    }
  }

  // ── Pull All ────────────────────────────────────────────

  async function pullAll() {
    pulling.value = true
    pullResults.value = []
    try {
      const gid = currentGroup.value ? `?group=${encodeURIComponent(currentGroup.value)}` : ''
      const res = await apiFetch(`/api/git/pull-all${gid}`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        pullResults.value = data.results || []
      }
      await loadAllSummaries()
    } catch { /* handled by ui */ }
    finally { pulling.value = false }
  }

  // ── Commit Log ─────────────────────────────────────────

  async function loadLog(repoId: number) {
    logRepoId.value = repoId
    logLoading.value = true
    logResult.value = null
    try {
      const res = await apiFetch(`/api/git/log/${repoId}?limit=100`)
      const data = await res.json()
      if (data.ok) {
        logResult.value = data as RepoLog
      }
    } catch { logResult.value = null }
    finally { logLoading.value = false }
  }

  // ── Init ───────────────────────────────────────────────

  async function init() {
    await loadGroups()
    await loadRepos()
    await loadAllSummaries()
  }

  // Auto-refresh when staged toggle changes
  watch(showStaged, () => refresh())

  return {
    repos, summaries, diffResult, showStaged, loading,
    expandedRepos, expandedFiles, showAddRepo, selectedFile,
    viewMode, fileSource, sourceLoading,
    groupList, currentGroup,
    loadRepos, loadGroups, setGroup, loadAllSummaries, selectRepo, selectFile, navigateToFile, collapseRepo,
    addRepo, removeRepo, refresh, init, loadFileSource, toggleViewMode,
    pulling, pullResults, pullAll,
    logResult, logLoading, logRepoId, repoViewMode, loadLog,
  }
})
