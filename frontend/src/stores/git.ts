// ── Git diff viewer store(按当前项目作用域;repo id 为 string) ──

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { apiFetch } from '@/utils/api-fetch'
import { useProjectsStore } from './projects'

export interface GitRepo {
  id: string
  name: string
  path: string
  notes?: string
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
  repoId: string
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
  repoId: string
  repoName: string
  branch: string
  error?: string
  clean: boolean
  fileCount: number
  additions: number
  deletions: number
}

export interface PullResult {
  repoId: string
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
  repoId: string
  repoName: string
  branch: string
  error?: string
  totalCommits: number
  dayGroups: DayGroup[]
}

export const useGitStore = defineStore('git', () => {
  const projects = useProjectsStore()

  const repos = ref<GitRepo[]>([])
  const summaries = ref<Record<string, RepoSummary>>({})
  const diffResult = ref<RepoDiff | null>(null)
  const showStaged = ref(false)
  const loading = ref(false)
  const expandedRepos = ref<Set<string>>(new Set())
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
  const logRepoId = ref<string | null>(null)
  const repoViewMode = ref<'diff' | 'log'>('diff')

  // ── URL 辅助 ──────────────────────────────────────────
  function qs(): string {
    return projects.currentId ? `project=${encodeURIComponent(projects.currentId)}` : ''
  }

  // ── 项目切换:清空本地状态再重载 ────────────────────────
  function resetState() {
    repos.value = []
    summaries.value = {}
    diffResult.value = null
    expandedRepos.value = new Set()
    expandedFiles.value = new Set()
    selectedFile.value = null
    pullResults.value = []
    logResult.value = null
    logRepoId.value = null
  }

  watch(() => projects.currentId, async () => {
    resetState()
    if (projects.currentId) {
      await loadRepos()
      await loadAllSummaries()
    }
  })

  // ── Actions ────────────────────────────────────────────

  async function loadRepos() {
    if (!projects.currentId) { repos.value = []; return }
    try {
      const res = await apiFetch(`/api/git/repos?${qs()}`)
      const data = await res.json()
      repos.value = data?.ok ? (data.data || []) : []
    } catch { repos.value = [] }
  }

  async function loadAllSummaries() {
    if (!projects.currentId) { summaries.value = {}; return }
    const results = await Promise.allSettled(
      repos.value.map(async r => {
        const res = await apiFetch(`/api/git/summary/${encodeURIComponent(r.id)}?${qs()}&staged=${showStaged.value}`)
        const data = await res.json()
        if (data?.ok) summaries.value[r.id] = data as RepoSummary
        return data
      })
    )
    void results
  }

  async function selectRepo(id: string) {
    if (expandedRepos.value.has(id)) {
      collapseRepo(id)
      return
    }
    expandedRepos.value.add(id)
    diffResult.value = null
    selectedFile.value = null
    expandedFiles.value = new Set()
    loading.value = true
    try {
      const staged = showStaged.value ? '&staged=true' : ''
      const res = await apiFetch(`/api/git/diff/${encodeURIComponent(id)}?${qs()}${staged}`)
      const data = await res.json()
      if (data?.ok) diffResult.value = data as RepoDiff
    } catch { diffResult.value = null }
    finally { loading.value = false }
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

  async function loadFileSource(repoId: string, filePath: string) {
    if (!projects.currentId) return
    sourceLoading.value = true
    try {
      const res = await apiFetch(`/api/git/source/${encodeURIComponent(repoId)}?${qs()}&file=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (data?.ok) fileSource.value = data.content
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

  function collapseRepo(id: string) {
    expandedRepos.value.delete(id)
    expandedRepos.value = new Set(expandedRepos.value)
    diffResult.value = null
    selectedFile.value = null
    expandedFiles.value = new Set()
  }

  async function addRepo(name: string, repoPath: string, notes?: string) {
    if (!projects.currentId) return
    const res = await apiFetch(`/api/git/repos?${qs()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, repoPath, notes }),
    })
    const data = await res.json()
    if (data?.ok) {
      await loadRepos()
      await loadAllSummaries()
      showAddRepo.value = false
    } else {
      throw new Error(data?.error || '添加失败')
    }
  }

  async function removeRepo(id: string) {
    if (!projects.currentId) return
    await apiFetch(`/api/git/repos/${encodeURIComponent(id)}?${qs()}`, { method: 'DELETE' })
    expandedRepos.value.delete(id)
    await loadRepos()
  }

  async function refresh() {
    await loadAllSummaries()
    // Also refresh expanded repo's full diff
    for (const id of expandedRepos.value) {
      const staged = showStaged.value ? '&staged=true' : ''
      const res = await apiFetch(`/api/git/diff/${encodeURIComponent(id)}?${qs()}${staged}`)
      const data = await res.json()
      if (data?.ok) diffResult.value = data as RepoDiff
    }
  }

  // ── Pull All ────────────────────────────────────────────

  async function pullAll() {
    if (!projects.currentId) return
    pulling.value = true
    pullResults.value = []
    try {
      const res = await apiFetch(`/api/git/pull-all?${qs()}`, { method: 'POST' })
      const data = await res.json()
      if (data?.ok) {
        pullResults.value = data.results || []
      }
      await loadAllSummaries()
    } catch { /* handled by ui */ }
    finally { pulling.value = false }
  }

  // ── Commit Log ─────────────────────────────────────────

  async function loadLog(repoId: string) {
    if (!projects.currentId) return
    logRepoId.value = repoId
    logLoading.value = true
    logResult.value = null
    try {
      const res = await apiFetch(`/api/git/log/${encodeURIComponent(repoId)}?${qs()}&limit=100`)
      const data = await res.json()
      if (data?.ok) logResult.value = data as RepoLog
    } catch { logResult.value = null }
    finally { logLoading.value = false }
  }

  // ── Init ───────────────────────────────────────────────

  async function init() {
    if (!projects.loaded) await projects.load()
    await loadRepos()
    await loadAllSummaries()
  }

  // Auto-refresh when staged toggle changes
  watch(showStaged, () => refresh())

  return {
    repos, summaries, diffResult, showStaged, loading,
    expandedRepos, expandedFiles, showAddRepo, selectedFile,
    viewMode, fileSource, sourceLoading,
    loadRepos, loadAllSummaries, selectRepo, selectFile, navigateToFile, collapseRepo,
    addRepo, removeRepo, refresh, init, loadFileSource, toggleViewMode,
    pulling, pullResults, pullAll,
    logResult, logLoading, logRepoId, repoViewMode, loadLog,
  }
})
