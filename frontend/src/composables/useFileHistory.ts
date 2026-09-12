// ── File History Composable — commit log + commit diff state ──
//   Extracted from stores/repo-browser.ts to keep concerns separated.

import { ref } from 'vue'
import { apiFetch, errText } from '@/utils/api-fetch'
import { projectQS } from '@/stores/projects'



// ── Types ──────────────────────────────────────────────────

export interface HistoryEntry {
  hash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
}

export interface DayGroup {
  date: string
  commits: HistoryEntry[]
}

export interface CommitFile {
  path: string
  status: string
  additions: number
  deletions: number
}

export interface CommitDiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

// ── Factory ────────────────────────────────────────────────

export function useFileHistory() {
  // ── View mode ──────────────────────────────────────────
  const viewMode = ref<'preview' | 'history'>('preview')

  // ── File history state ────────────────────────────────
  const fileHistory = ref<HistoryEntry[]>([])
  const fileHistoryDayGroups = ref<DayGroup[]>([])
  const historyLoading = ref(false)
  const historyError = ref('')
  const historyLoadedForFile = ref('')

  // ── Commit diff state (current selected commit) ────────
  const selectedCommit = ref<string | null>(null)
  const commitSubject = ref('')
  const commitAuthor = ref('')
  const commitDate = ref('')

  // ── Commit file list (all files changed in a commit) ──
  const commitFiles = ref<CommitFile[]>([])
  const commitFilesLoading = ref(false)
  const commitFilesError = ref('')
  const commitTotalAdditions = ref(0)
  const commitTotalDeletions = ref(0)

  // ── Per-file diff within a commit ─────────────────────
  const selectedCommitFilePath = ref<string | null>(null)
  const commitFileDiffLines = ref<CommitDiffLine[]>([])
  const commitFileDiffAdditions = ref(0)
  const commitFileDiffDeletions = ref(0)
  const commitFileDiffLoading = ref(false)
  const commitFileDiffError = ref('')

  // ── Actions ──────────────────────────────────────────────

  function switchToPreview() {
    viewMode.value = 'preview'
    resetCommitState()
  }

  function switchToHistory() {
    viewMode.value = 'history'
    resetCommitState()
  }

  /** Reset all commit-related state (keep viewMode intact) */
  function resetCommitState() {
    selectedCommit.value = null
    commitSubject.value = ''
    commitAuthor.value = ''
    commitDate.value = ''
    commitFiles.value = []
    commitFilesLoading.value = false
    commitFilesError.value = ''
    commitTotalAdditions.value = 0
    commitTotalDeletions.value = 0
    selectedCommitFilePath.value = null
    commitFileDiffLines.value = []
    commitFileDiffAdditions.value = 0
    commitFileDiffDeletions.value = 0
    commitFileDiffLoading.value = false
    commitFileDiffError.value = ''
  }

  /** Reset all history state (view mode + commits + file history) */
  function resetAll() {
    viewMode.value = 'preview'
    resetCommitState()
    fileHistory.value = []
    fileHistoryDayGroups.value = []
    historyLoading.value = false
    historyError.value = ''
    historyLoadedForFile.value = ''
  }

  async function loadFileHistory(repoId: string, filePath: string) {
    historyLoading.value = true
    historyError.value = ''
    fileHistory.value = []
    fileHistoryDayGroups.value = []

    try {
      const url = `/api/repo-browser/${encodeURIComponent(repoId)}/file-log?path=${encodeURIComponent(filePath)}&limit=50&${projectQS()}`
      const res = await apiFetch(url)
      const data = await res.json()
      if (data.ok) {
        fileHistoryDayGroups.value = data.dayGroups || []
        // Flatten for easy access
        const all: HistoryEntry[] = []
        for (const g of data.dayGroups || []) {
          for (const c of g.commits) all.push(c)
        }
        fileHistory.value = all
        historyLoadedForFile.value = filePath
      } else {
        historyError.value = data.error || 'Failed to load history'
      }
    } catch (e) {
      historyError.value = errText(e, 'Network error')
    } finally {
      historyLoading.value = false
    }
  }

  async function loadCommitFiles(repoId: string, commitHash: string) {
    commitFilesLoading.value = true
    commitFilesError.value = ''
    commitFiles.value = []
    commitTotalAdditions.value = 0
    commitTotalDeletions.value = 0
    selectedCommitFilePath.value = null
    commitFileDiffLines.value = []

    try {
      const url = `/api/repo-browser/${encodeURIComponent(repoId)}/commit-files?commit=${encodeURIComponent(commitHash)}&${projectQS()}`
      const res = await apiFetch(url)
      const data = await res.json()
      if (data.ok) {
        commitFiles.value = data.files || []
        commitTotalAdditions.value = data.totalAdditions || 0
        commitTotalDeletions.value = data.totalDeletions || 0
        commitSubject.value = data.subject || ''
        commitAuthor.value = data.author || ''
        commitDate.value = data.date || ''
      } else {
        commitFilesError.value = data.error || 'Failed to load commit files'
      }
    } catch (e) {
      commitFilesError.value = errText(e, 'Network error')
    } finally {
      commitFilesLoading.value = false
    }
  }

  async function selectCommit(repoId: string, commitHash: string, currentFilePath?: string | null) {
    selectedCommit.value = commitHash
    commitFileDiffLines.value = []
    commitFileDiffAdditions.value = 0
    commitFileDiffDeletions.value = 0

    // Load the full commit file list
    await loadCommitFiles(repoId, commitHash)

    // Also load the diff for the currently selected file (if any)
    if (currentFilePath) {
      await loadCommitFileDiff(repoId, commitHash, currentFilePath)
    }
  }

  async function loadCommitFileDiff(repoId: string, commitHash: string, filePath: string) {
    selectedCommitFilePath.value = filePath
    commitFileDiffLoading.value = true
    commitFileDiffError.value = ''
    commitFileDiffLines.value = []
    commitFileDiffAdditions.value = 0
    commitFileDiffDeletions.value = 0

    try {
      const url = `/api/repo-browser/${encodeURIComponent(repoId)}/file-commit-diff?path=${encodeURIComponent(filePath)}&commit=${encodeURIComponent(commitHash)}&${projectQS()}`
      const res = await apiFetch(url)
      const data = await res.json()
      if (data.ok) {
        commitFileDiffLines.value = data.lines || []
        commitFileDiffAdditions.value = data.additions || 0
        commitFileDiffDeletions.value = data.deletions || 0
      } else {
        commitFileDiffError.value = data.error || 'Failed to load file diff'
      }
    } catch (e) {
      commitFileDiffError.value = errText(e, 'Network error')
    } finally {
      commitFileDiffLoading.value = false
    }
  }

  async function selectCommitFile(repoId: string, commitHash: string, filePath: string) {
    await loadCommitFileDiff(repoId, commitHash, filePath)
  }

  return {
    // State
    viewMode,
    fileHistory,
    fileHistoryDayGroups,
    historyLoading,
    historyError,
    historyLoadedForFile,
    selectedCommit,
    commitSubject,
    commitAuthor,
    commitDate,
    commitFiles,
    commitFilesLoading,
    commitFilesError,
    commitTotalAdditions,
    commitTotalDeletions,
    selectedCommitFilePath,
    commitFileDiffLines,
    commitFileDiffAdditions,
    commitFileDiffDeletions,
    commitFileDiffLoading,
    commitFileDiffError,
    // Actions
    switchToPreview,
    switchToHistory,
    resetAll,
    resetCommitState,
    loadFileHistory,
    loadCommitFiles,
    selectCommit,
    loadCommitFileDiff,
    selectCommitFile,
  }
}
