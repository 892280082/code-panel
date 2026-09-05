<script setup lang="ts">
import { useOverlayLayer, raise } from '@/utils/z-layer'
import { computed, nextTick, ref, onMounted, onUnmounted, watch } from 'vue'
import type { DirEntry } from '@/stores/repo-browser'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { copyToClipboard } from '@/utils/clipboard'

const props = defineProps<{
  repoId: string
  subPath: string
  entries: DirEntry[]
  depth: number
}>()
const { zIndex, onRaise } = useOverlayLayer()

const store = useRepoBrowserStore()

const isExpanded = computed(() => store.isExpanded(props.subPath))
const isLoading = computed(() => store.loadingDirs.has(props.subPath || '__ROOT__'))
const isEmpty = computed(() =>
  isExpanded.value && !isLoading.value &&
  store.getEntries(props.subPath).length === 0 &&
  (props.subPath || '__ROOT__') in store.treeCache
)

const dirs = computed(() => props.entries.filter(e => {
  if (e.type !== 'dir') return false
  if (!store.gitMode) return true
  const fullPath = joinPath(props.subPath, e.name)
  return store.isDirChanged(fullPath)
}))
const files = computed(() => props.entries.filter(e => {
  if (e.type !== 'file') return false
  if (!store.gitMode) return true
  return store.isFileChanged(joinPath(props.subPath, e.name))
}))

function handleToggleDir(dirPath: string) {
  store.toggleDir(dirPath)
}

function handleSelectFile(filePath: string) {
  store.selectFile(filePath)
}

function isSelected(filePath: string): boolean {
  return store.selectedFilePath === filePath
}

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

// ── Keyboard navigation ──────────────────────────────────
const treeEl = ref<HTMLElement | null>(null)

function getFocusableRows(): HTMLElement[] {
  if (!treeEl.value) return []
  return Array.from(treeEl.value.querySelectorAll('[data-tree-path]')) as HTMLElement[]
}

function handleKeydown(e: KeyboardEvent) {
  const rows = getFocusableRows()
  if (rows.length === 0) return

  const current = document.activeElement as HTMLElement
  const idx = rows.indexOf(current)
  const nextIdx = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1)
    : e.key === 'ArrowUp' ? Math.max(idx - 1, 0)
    : -1

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (nextIdx >= 0) rows[nextIdx].focus()
    return
  }

  if (e.key === 'Enter' && current) {
    e.preventDefault()
    current.click()
  }
}

// Auto-focus first row when root entries load
watch(() => props.entries, async () => {
  if (props.depth === 0 && props.entries.length > 0) {
    await nextTick()
    const rows = getFocusableRows()
    if (rows.length > 0 && document.activeElement !== rows[0]) {
      rows[0].focus()
    }
  }
}, { immediate: true })

// ── Context menu (复制路径) ──────────────────────────────
const contextMenu = ref<{ show: boolean; x: number; y: number; path: string; isDir: boolean }>({
  show: false, x: 0, y: 0, path: '', isDir: false,
})
// 右键菜单打开时置顶（层级与终端/弹窗共用计数器）
watch(() => contextMenu.value.show, (v) => { if (v) zIndex.value = raise() })

function handleContextMenu(e: MouseEvent, entryPath: string, isDir: boolean) {
  e.preventDefault()
  contextMenu.value = { show: true, x: e.clientX, y: e.clientY, path: entryPath, isDir }
}

function closeContextMenu() {
  contextMenu.value.show = false
}

function copyRelativePath() {
  copyToClipboard(contextMenu.value.path)
  closeContextMenu()
}

function copyAbsolutePath() {
  const base = store.repoPath
  const fullPath = base ? `${base}/${contextMenu.value.path}` : contextMenu.value.path
  copyToClipboard(fullPath)
  closeContextMenu()
}

function handleGlobalClick(e: MouseEvent) {
  if (contextMenu.value.show && !(e.target as HTMLElement)?.closest('.context-menu')) {
    closeContextMenu()
  }
}

onMounted(() => window.addEventListener('click', handleGlobalClick))
onUnmounted(() => window.removeEventListener('click', handleGlobalClick))
</script>

<template>
  <div ref="treeEl" class="tree-node" @keydown="handleKeydown">
    <template v-for="entry in dirs" :key="'d-' + joinPath(subPath, entry.name)">
      <div
        class="tree-row dir-row"
        :class="{ expanded: store.isExpanded(joinPath(subPath, entry.name)) }"
        :data-tree-path="joinPath(subPath, entry.name)"
        :style="{ paddingLeft: (depth * 16 + 12) + 'px' }"
        tabindex="0"
        @click="handleToggleDir(joinPath(subPath, entry.name))"
        @contextmenu="handleContextMenu($event, joinPath(subPath, entry.name), true)"
      >
        <span class="toggle-icon">{{ store.isExpanded(joinPath(subPath, entry.name)) ? '▼' : '▶' }}</span>
        <span class="entry-icon dir-icon">📁</span>
        <span class="entry-name">{{ entry.name }}</span>
        <span v-if="isLoading" class="loading-spinner">⏳</span>
      </div>

      <FileTreeNode
        v-if="store.isExpanded(joinPath(subPath, entry.name))"
        :repoId="repoId"
        :subPath="joinPath(subPath, entry.name)"
        :entries="store.getEntries(joinPath(subPath, entry.name))"
        :depth="depth + 1"
        @select-file="(p: string) => $emit('select-file', p)"
      />

      <div
        v-if="isEmpty && store.isExpanded(joinPath(subPath, entry.name))"
        class="tree-row empty-row"
        :style="{ paddingLeft: ((depth + 1) * 16 + 12) + 'px' }"
      >
        <span class="toggle-icon file-spacer"></span>
        <span class="entry-name dim">(空目录)</span>
      </div>

      <div
        v-if="store.dirError(joinPath(subPath, entry.name)) && store.isExpanded(joinPath(subPath, entry.name))"
        class="tree-row dir-error-row"
        :style="{ paddingLeft: ((depth + 1) * 16 + 12) + 'px' }"
        :title="store.dirError(joinPath(subPath, entry.name))"
        @click="store.loadDir(joinPath(subPath, entry.name))"
      >
        <span class="toggle-icon file-spacer"></span>
        <span class="entry-name dim">⚠ 目录加载失败，点击重试</span>
      </div>
    </template>

    <div
      v-for="entry in files"
      :key="'f-' + joinPath(subPath, entry.name)"
      class="tree-row file-row"
      :class="{ selected: isSelected(joinPath(subPath, entry.name)) }"
      :data-tree-path="joinPath(subPath, entry.name)"
      :style="{ paddingLeft: (depth * 16 + 12) + 'px' }"
      tabindex="0"
      @click="handleSelectFile(joinPath(subPath, entry.name))"
      @contextmenu="handleContextMenu($event, joinPath(subPath, entry.name), false)"
    >
      <span class="toggle-icon file-spacer"></span>
      <span class="entry-icon file-icon">📄</span>
      <span class="entry-name">{{ entry.name }}</span>
      <span v-if="store.gitMode && store.isFileChanged(joinPath(subPath, entry.name))" class="git-dot" title="已改动">●</span>
      <span class="entry-size">{{ formatSize(entry.size) }}</span>
    </div>
  </div>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="contextMenu.show"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px', zIndex }"
      @pointerdown.capture="onRaise"
    >
      <div class="context-menu-item" @click="copyRelativePath">
        <span class="ctx-icon">📁</span>
        <span class="ctx-label">复制相对路径</span>
      </div>
      <div class="context-menu-item" @click="copyAbsolutePath">
        <span class="ctx-icon">📂</span>
        <span class="ctx-label">复制绝对路径</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tree-node { outline: none; min-width: max-content; }
.tree-row {
  display: flex; align-items: center; gap: 2px;
  padding: 4px 12px; font-size: 11px;
  cursor: pointer; white-space: nowrap;
  transition: background 0.1s;
  border-bottom: 1px solid rgba(35,35,42,0.12);
  user-select: none; outline: none;
  /* 行宽按内容撑开: 递归层级深时文件名不被截断, 由顶部横向滚动条拉动查看 */
  min-width: max-content;
}
.tree-row:hover { background: rgba(34,238,102,0.04); }
.tree-row:focus { background: rgba(68,153,238,0.12); border-left: 2px solid var(--info); }
.tree-row.selected { background: rgba(34,238,102,0.08); border-left: 2px solid var(--glow-dim); }

.empty-row { cursor: default; }
.empty-row:hover { background: transparent; }
.dir-error-row { cursor: pointer; font-size: 10px; }
.dir-error-row:hover { background: rgba(242,96,96,0.06); }
.entry-name.dim { color: var(--text-dim); font-style: italic; }

.toggle-icon { width: 14px; flex-shrink: 0; text-align: center; font-size: 8px; color: var(--text-dim); }
.file-spacer { visibility: hidden; }

.entry-icon { width: 20px; flex-shrink: 0; text-align: center; font-size: 12px; }
.dir-icon { color: var(--glow-dim); }
.file-icon { color: var(--text-dim); }

.entry-name { flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-size: 11px; }
.entry-size { flex-shrink: 0; font-size: 9px; color: var(--text-dim); font-variant-numeric: tabular-nums; margin-left: 6px; }
.git-dot { color: #f2cc60; font-size: 10px; flex-shrink: 0; }
.loading-spinner { font-size: 10px; }
.dir-row.expanded > .entry-name { color: var(--glow); }

/* ── Context menu ───────────────────────────────────────── */
.context-menu {
  position: fixed; 
  min-width: 180px;
  background: #1e1e26;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  padding: 4px 0;
  animation: ctxFadeIn 0.12s ease;
}
@keyframes ctxFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
.context-menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px; font-size: 11px;
  color: var(--text); cursor: pointer;
  transition: background 0.1s;
  white-space: nowrap;
}
.context-menu-item:hover { background: rgba(34,238,102,0.1); }
.ctx-icon { font-size: 12px; width: 18px; text-align: center; flex-shrink: 0; }
.ctx-label { color: var(--text); }
</style>
