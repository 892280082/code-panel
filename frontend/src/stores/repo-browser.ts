// ── Repo Browser Store — file tree + segmented file loading ──
//   History/commit state lives in useFileHistory composable.

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { apiJson, errText } from '@/utils/api-fetch'
import { raise } from '@/utils/z-layer'
import { useFileHistory } from '@/composables/useFileHistory'
import { useProjectsStore } from './projects'

// ── Types ────────────────────────────────────────────────

export interface GitRepoLite {
  id: string
  name: string
  path: string
}

export interface DirEntry {
  name: string
  type: 'file' | 'dir'
  size: number
}

export interface TreeResult {
  ok: boolean
  error?: string
  repoId: string
  repoName: string
  path: string
  entries: DirEntry[]
}

export interface FileChunk {
  ok: boolean
  error?: string
  path: string
  content: string
  lang: string
  offset: number
  limit: number
  totalSize: number
  hasMore: boolean
  binary: boolean
}

// ── Store ────────────────────────────────────────────────

export const useRepoBrowserStore = defineStore('repoBrowser', () => {
  const projects = useProjectsStore()

  // ── Modal state ───────────────────────────────────────
  const visible = ref(false)
  const repoId = ref<string | null>(null)
  const repoName = ref('')
  const repoPath = ref('')

  // 最近打开的仓库：持久化到 localStorage，刷新后任务栏 📂 图标仍可直接重开
  const LAST_REPO_KEY = 'repo-browser:last'
  const lastRepo = ref<{ id: string; name: string; path: string } | null>(null)
  try {
    const saved = localStorage.getItem(LAST_REPO_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed.id === 'string' && parsed.name) {
        lastRepo.value = parsed
        repoId.value = parsed.id
        repoName.value = parsed.name
        repoPath.value = parsed.path || ''
      }
    }
  } catch { /* 忽略损坏的本地记录 */ }

  // 项目切换 → 关闭浏览器窗口(旧项目仓库不应残留)
  watch(() => projects.currentId, () => {
    if (visible.value) closeModal()
  })

  // ── 浮动窗口状态（与终端窗口同一层级体系）─────────────────
  //   不再用全屏遮罩：点别处（如终端）不关闭，只是沉到下层；
  //   最小化 → 缩成 💻 右侧的 📂 小图标，点图标恢复。
  const zIndex = ref(raise())
  const minimized = ref(false)
  const maximized = ref(false)

  // ── Tree state ────────────────────────────────────────
  const treeCache = ref<Record<string, DirEntry[]>>({})   // key = "path" (subPath)
  const expandedDirs = ref<Set<string>>(new Set())
  const loadingDirs = ref<Set<string>>(new Set())
  const treeError = ref('')          // 仅根目录加载失败时显示
  const dirErrors = ref<Record<string, string>>({})   // 单目录失败 → 只标记该节点, 不影响其他目录

  // ── Git tracking mode ─────────────────────────────────
  const gitMode = ref(false)  // 默认显示全部文件（改动文件在 Git 页签层级树已有,弹窗默认全仓库浏览）
  const changedDirs = ref<Set<string>>(new Set())
  const changedFiles = ref<Set<string>>(new Set())
  const gitLoading = ref(false)

  /** 当前项目 query(?project=<id>);无项目返回 '' */
  function qs(): string {
    return projects.currentId ? `project=${encodeURIComponent(projects.currentId)}` : ''
  }

  async function loadGitChanges(id: string) {
    gitLoading.value = true
    try {
      const data = await apiJson<{ changedDirs: string[]; changedFiles: string[] }>(`/api/repo-browser/${encodeURIComponent(id)}/git-changes?${qs()}`)
      changedDirs.value = new Set(data.changedDirs)
      changedFiles.value = new Set(data.changedFiles)
    } catch { /* ignore */ }
    gitLoading.value = false
  }

  function isDirChanged(subPath: string): boolean {
    if (!gitMode.value) return true // show all in normal mode
    if (subPath === '' || subPath === '__ROOT__') return true // root always shown
    return changedDirs.value.has(subPath) || changedFiles.value.has(subPath)
  }

  function isFileChanged(subPath: string): boolean {
    return changedFiles.value.has(subPath)
  }

  /** 加载 Git 改动 + 自动展开所有改动目录（打开窗口与切到 Git 模式共用） */
  async function ensureGitChanges() {
    if (!repoId.value || !projects.currentId) return
    // Ensure git changes are loaded
    if (changedDirs.value.size === 0 && changedFiles.value.size === 0) {
      await loadGitChanges(repoId.value)
    }
    // Auto-expand all changed dirs and preload them
    const expanded = new Set(expandedDirs.value)
    for (const dir of changedDirs.value) {
      // Preload each level of the directory tree
      const parts = dir.split('/')
      for (let i = 0; i < parts.length; i++) {
        const sub = parts.slice(0, i + 1).join('/')
        expanded.add(sub)
        loadDir(sub) // fire-and-forget preload
      }
    }
    expandedDirs.value = expanded
  }

  async function toggleGitMode() {
    gitMode.value = !gitMode.value
    if (gitMode.value) {
      await ensureGitChanges()
    }
  }

  // ── File state ────────────────────────────────────────
  const selectedFilePath = ref<string | null>(null)
  const fileContent = ref('')
  const fileLang = ref('plaintext')
  const showDiff = ref(false)
  const diffLines = ref<{ type: 'add' | 'del' | 'ctx'; text: string }[]>([])
  const diffLoading = ref(false)
  const fileOffset = ref(0)
  const fileTotalSize = ref(0)
  const fileHasMore = ref(false)
  const fileBinary = ref(false)
  const fileLoading = ref(false)
  const fileError = ref('')

  // ── File history (extracted composable) ───────────────
  const fileHistory = useFileHistory()

  // ── Computed ──────────────────────────────────────────
  const loadedRatio = computed(() => {
    if (fileTotalSize.value === 0) return 0
    return Math.min(1, (fileOffset.value + (fileContent.value ? new Blob([fileContent.value]).size : 0)) / fileTotalSize.value)
  })

  const loadedKB = computed(() => {
    const size = fileOffset.value + (fileContent.value ? new Blob([fileContent.value]).size : 0)
    return Math.round(size / 1024)
  })

  const totalKB = computed(() => Math.round(fileTotalSize.value / 1024))

  // ── Actions ───────────────────────────────────────────

  function cacheKey(subPath: string) { return subPath || '__ROOT__' }

  function openModal(id: string, name: string, path?: string) {
    visible.value = true
    minimized.value = false
    maximized.value = false   // 每次新打开恢复常规尺寸
    zIndex.value = raise()   // 打开即置顶（与终端窗口共用计数器）
    repoId.value = id
    repoName.value = name
    repoPath.value = path || ''
    lastRepo.value = { id, name, path: path || '' }
    try { localStorage.setItem(LAST_REPO_KEY, JSON.stringify(lastRepo.value)) } catch {}
    treeCache.value = {}
    expandedDirs.value = new Set(['__ROOT__'])  // root always expanded
    loadingDirs.value = new Set()
    treeError.value = ''
    dirErrors.value = {}
    selectedFilePath.value = null
    fileContent.value = ''
    fileLang.value = 'plaintext'
    fileOffset.value = 0
    fileTotalSize.value = 0
    fileHasMore.value = false
    fileBinary.value = false
    fileError.value = ''
    gitMode.value = false  // 默认全部文件(改动文件走 Git 页签层级树;可手动切 🔀 Git)
    changedDirs.value = new Set()
    changedFiles.value = new Set()
    fileHistory.resetAll()

    // Load root directory + git changes（并自动展开改动目录）
    loadDir('')
    ensureGitChanges()
  }

  function closeModal() {
    visible.value = false
  }

  // ── 浮动窗口操作：置顶 / 最小化 / 恢复 ──────────────────
  function bringToFront() {
    zIndex.value = raise()
  }

  function minimize() {
    minimized.value = true
  }

  function restore() {
    minimized.value = false
    zIndex.value = raise()   // 恢复时同时置顶
  }

  function toggleMinimize() {
    if (minimized.value) restore()
    else minimize()
  }

  // 最大化：铺满视口；组件内 watch 负责记录/还原最大化前的位置尺寸
  function toggleMaximize() {
    maximized.value = !maximized.value
  }

  function setDirError(key: string, msg: string) {
    if (key === '__ROOT__') {
      treeError.value = msg
    } else {
      dirErrors.value = { ...dirErrors.value, [key]: msg }
    }
  }

  function clearDirError(key: string) {
    if (key === '__ROOT__') {
      if (treeError.value) treeError.value = ''
    } else if (dirErrors.value[key]) {
      const next = { ...dirErrors.value }
      delete next[key]
      dirErrors.value = next
    }
  }

  function dirError(subPath: string): string {
    return dirErrors.value[cacheKey(subPath)] || ''
  }

  async function loadDir(subPath: string) {
    const key = cacheKey(subPath)
    // Cache empty dirs as a special marker so we don't retry
    if (key in treeCache.value || loadingDirs.value.has(key)) return

    loadingDirs.value = new Set(loadingDirs.value).add(key)

    if (!repoId.value || !projects.currentId) return
    try {
      const params = subPath ? `?path=${encodeURIComponent(subPath)}` : ''
      const q = qs()
      const url = `/api/repo-browser/${encodeURIComponent(repoId.value)}/tree${params}${q ? (params ? '&' : '?') + q : ''}`
      const data = await apiJson<TreeResult>(url)
      treeCache.value = { ...treeCache.value, [key]: data.entries.length ? data.entries : [] }
      clearDirError(key)
    } catch (e) {
      setDirError(key, errText(e, 'Network error'))
      delete treeCache.value[key] // allow retry on error
    } finally {
      const next = new Set(loadingDirs.value)
      next.delete(key)
      loadingDirs.value = next
    }
  }

  function toggleDir(subPath: string) {
    const key = cacheKey(subPath)
    if (expandedDirs.value.has(key)) {
      const next = new Set(expandedDirs.value)
      next.delete(key)
      expandedDirs.value = next
    } else {
      // Load if not cached
      if (!treeCache.value[key]) {
        loadDir(subPath)
      }
      const next = new Set(expandedDirs.value)
      next.add(key)
      expandedDirs.value = next
    }
  }

  function isExpanded(subPath: string): boolean {
    return expandedDirs.value.has(cacheKey(subPath))
  }

  function getEntries(subPath: string): DirEntry[] {
    return treeCache.value[cacheKey(subPath)] || []
  }

  async function selectFile(subPath: string) {
    selectedFilePath.value = subPath
    fileContent.value = ''
    fileOffset.value = 0
    fileTotalSize.value = 0
    fileHasMore.value = false
    fileBinary.value = false
    fileError.value = ''
    fileLang.value = 'plaintext'
    diffLines.value = []
    showDiff.value = false
    fileHistory.resetAll()

    await loadMoreFile()
    // Auto-load diff if file is changed (regardless of git mode)
    if (changedFiles.value.has(subPath)) {
      loadDiff(subPath)
      showDiff.value = true  // default to diff view for changed files
    }
  }

  async function loadDiff(subPath: string) {
    if (!repoId.value || !projects.currentId) return
    diffLoading.value = true
    try {
      const url = `/api/repo-browser/${encodeURIComponent(repoId.value)}/diff?path=${encodeURIComponent(subPath)}&${qs()}`
      const data = await apiJson<{ lines: { type: 'add' | 'del' | 'ctx'; text: string }[] }>(url)
      diffLines.value = data.lines
    } catch { diffLines.value = [] }
    diffLoading.value = false
  }

  function toggleDiff() {
    showDiff.value = !showDiff.value
  }

  async function loadMoreFile() {
    if (!selectedFilePath.value || !repoId.value || !projects.currentId) return
    fileLoading.value = true
    fileError.value = ''

    try {
      const offset = fileOffset.value + (fileContent.value ? new Blob([fileContent.value]).size : 0)
      const params = `?path=${encodeURIComponent(selectedFilePath.value)}&offset=${offset}&limit=102400`
      const url = `/api/repo-browser/${encodeURIComponent(repoId.value)}/file${params}&${qs()}`
      const data = await apiJson<FileChunk>(url)

      fileLang.value = data.lang || 'plaintext'
      fileTotalSize.value = data.totalSize
      fileHasMore.value = data.hasMore
      fileBinary.value = data.binary
      fileOffset.value = data.offset

      if (data.binary) {
        fileContent.value = ''
      } else {
        fileContent.value = fileContent.value + data.content
      }
    } catch (e) {
      fileError.value = errText(e, 'Network error')
    } finally {
      fileLoading.value = false
    }
  }

  function clearFile() {
    selectedFilePath.value = null
    fileContent.value = ''
    fileLang.value = 'plaintext'
    fileOffset.value = 0
    fileTotalSize.value = 0
    fileHasMore.value = false
    fileBinary.value = false
    fileError.value = ''
  }

  // ── File history integration ──────────────────────────

  /**
   * Delegate: load history when switching to history view.
   * Called from switchToHistory (below) — reloads if file changed.
   */
  function ensureHistoryLoaded() {
    const fp = selectedFilePath.value
    if (fp && repoId.value &&
        (fileHistory.fileHistory.value.length === 0 || fileHistory.historyLoadedForFile.value !== fp)) {
      fileHistory.loadFileHistory(repoId.value, fp)
    }
  }

  // ── Wrapper for selectCommit that auto-injects repoId ──
  function selectCommit(commitHash: string) {
    if (repoId.value && selectedFilePath.value) {
      fileHistory.selectCommit(repoId.value, commitHash, selectedFilePath.value)
    }
  }

  function switchToPreview() {
    fileHistory.switchToPreview()
  }

  function switchToHistory() {
    fileHistory.switchToHistory()
    ensureHistoryLoaded()
  }

  function selectCommitFile(filePath: string) {
    const commit = fileHistory.selectedCommit.value
    if (commit && repoId.value) {
      fileHistory.selectCommitFile(repoId.value, commit, filePath)
    }
  }

  return {
    // Modal
    visible, repoId, repoName, repoPath,
    openModal, closeModal,
    // 浮动窗口
    zIndex, minimized, maximized,
    bringToFront, minimize, restore, toggleMinimize, toggleMaximize,
    // Tree
    treeCache, expandedDirs, loadingDirs, treeError, dirErrors, dirError,
    loadDir, toggleDir, isExpanded, getEntries,
    // Git mode
    gitMode, changedDirs, changedFiles, gitLoading,
    loadGitChanges, isDirChanged, isFileChanged, toggleGitMode,
    // File
    selectedFilePath, fileContent, fileLang,
    fileOffset, fileTotalSize, fileHasMore, fileBinary,
    fileLoading, fileError,
    loadedRatio, loadedKB, totalKB,
    selectFile, loadMoreFile, clearFile, showDiff, diffLines, diffLoading, toggleDiff,
    // File history (re-exported from composable)
    viewMode: fileHistory.viewMode,
    fileHistory: fileHistory.fileHistory,
    fileHistoryDayGroups: fileHistory.fileHistoryDayGroups,
    historyLoading: fileHistory.historyLoading,
    historyError: fileHistory.historyError,
    historyLoadedForFile: fileHistory.historyLoadedForFile,
    selectedCommit: fileHistory.selectedCommit,
    commitSubject: fileHistory.commitSubject,
    commitAuthor: fileHistory.commitAuthor,
    commitDate: fileHistory.commitDate,
    commitFiles: fileHistory.commitFiles,
    commitFilesLoading: fileHistory.commitFilesLoading,
    commitFilesError: fileHistory.commitFilesError,
    commitTotalAdditions: fileHistory.commitTotalAdditions,
    commitTotalDeletions: fileHistory.commitTotalDeletions,
    selectedCommitFilePath: fileHistory.selectedCommitFilePath,
    commitFileDiffLines: fileHistory.commitFileDiffLines,
    commitFileDiffAdditions: fileHistory.commitFileDiffAdditions,
    commitFileDiffDeletions: fileHistory.commitFileDiffDeletions,
    commitFileDiffLoading: fileHistory.commitFileDiffLoading,
    commitFileDiffError: fileHistory.commitFileDiffError,
    switchToPreview, switchToHistory,
    selectCommit, selectCommitFile,
  }
})
