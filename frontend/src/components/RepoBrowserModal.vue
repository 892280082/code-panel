<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import FileTreeNode from './FileTreeNode.vue'
import FilePreview from './FilePreview.vue'
import { useRepoBrowserStore } from '@/stores/repo-browser'

const props = defineProps<{
  visible: boolean
  repoId: number | null
  repoName: string
}>()

const emit = defineEmits<{
  close: []
}>()

const store = useRepoBrowserStore()

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    emit('close')
  }
}

// ── 浮动窗口（与终端同款）：无全屏遮罩，点别处不关闭、只是沉到下层 ──
//   位置持久化到 localStorage；尺寸按视口自适应（首次打开居中）

const POS_KEY = 'drag-pos:repo-browser'
const x = ref(0)
const y = ref(0)
const w = ref(0)
const h = ref(0)

function initGeometry() {
  w.value = Math.min(1200, window.innerWidth - 60)
  h.value = Math.min(800, window.innerHeight - 80)
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { x: number; y: number }
      x.value = Math.max(0, Math.min(saved.x, window.innerWidth - 80))
      y.value = Math.max(0, Math.min(saved.y, window.innerHeight - 40))
      return
    }
  } catch { /* ignore */ }
  x.value = Math.max(8, (window.innerWidth - w.value) / 2)
  y.value = Math.max(8, (window.innerHeight - h.value) / 2)
}
initGeometry()

// ── 最大化：进入时记录当前位置尺寸，退出时还原 ──────────────
const savedGeo = ref<{ x: number; y: number; w: number; h: number } | null>(null)

watch(() => store.maximized, (max) => {
  if (max) {
    savedGeo.value = { x: x.value, y: y.value, w: w.value, h: h.value }
  } else if (savedGeo.value) {
    x.value = savedGeo.value.x; y.value = savedGeo.value.y
    w.value = savedGeo.value.w; h.value = savedGeo.value.h
    savedGeo.value = null
  }
})

// ── Drag（Pointer Events + setPointerCapture，同 FloatingTerminal）──
//   标题栏上的按钮（最小化/最大化/关闭/Git 开关）不进入拖拽；
//   preventDefault 只在真正开始移动时调用 —— 这样标题栏
//   单击/双击（双击=最大化）不会被 pointerdown 抑制
const dragging = ref(false)
const titlebarEl = ref<HTMLElement | null>(null)
let dragStartX = 0, dragStartY = 0, winStartX = 0, winStartY = 0

function onDragStart(e: PointerEvent) {
  if (e.button !== 0 || store.maximized) return   // 最大化时不可拖动
  if ((e.target as HTMLElement)?.closest('button, .toggle-switch')) return
  dragging.value = true
  dragStartX = e.clientX; dragStartY = e.clientY
  winStartX = x.value; winStartY = y.value
  try { titlebarEl.value?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
}

function onDragMove(e: PointerEvent) {
  if (!dragging.value) return
  if (e.buttons !== 1) { onDragEnd(); return }
  if (e.cancelable) e.preventDefault()   // 首次移动时阻止原生选中/拖拽
  x.value = winStartX + e.clientX - dragStartX
  y.value = winStartY + e.clientY - dragStartY
}

function onDragEnd() {
  if (!dragging.value) return
  dragging.value = false
  try { localStorage.setItem(POS_KEY, JSON.stringify({ x: x.value, y: y.value })) } catch { /* ignore */ }
}

// 双击标题栏空白处 = 最大化/还原（按钮区域不响应）
function onTitleDblClick(e: MouseEvent) {
  if ((e.target as HTMLElement)?.closest('button, .toggle-switch')) return
  store.toggleMaximize()
}

onUnmounted(() => { dragging.value = false })

// ── 顶部横向滚动条: 目录树递归层级深, 行内容可能超出面板宽度,
//    在面板最上方固定一条滚动条, 与树滚动区域双向同步 ──
const treeScroll = ref<HTMLElement | null>(null)
const treeHScroll = ref<HTMLElement | null>(null)
const treeContentWidth = ref(0)

function refreshHScrollWidth() {
  const el = treeScroll.value
  if (el) treeContentWidth.value = el.scrollWidth
}

function onTreeScroll() {
  if (treeScroll.value && treeHScroll.value) {
    treeHScroll.value.scrollLeft = treeScroll.value.scrollLeft
  }
}

function onHScroll() {
  if (treeScroll.value && treeHScroll.value) {
    treeScroll.value.scrollLeft = treeHScroll.value.scrollLeft
  }
}

// 树数据变化(展开/加载/失败)后重新测量内容宽度, 刷新顶部滚动条行程
watch(
  () => [store.treeCache, store.expandedDirs, store.loadingDirs, store.dirErrors],
  async () => {
    await nextTick()
    refreshHScrollWidth()
  },
)

onMounted(() => window.addEventListener('keydown', handleEsc))
onUnmounted(() => window.removeEventListener('keydown', handleEsc))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      v-show="!store.minimized"
      class="repo-win"
      :class="{ dragging, maximized: store.maximized }"
      :style="{
        left: (store.maximized ? 0 : x) + 'px',
        top: (store.maximized ? 0 : y) + 'px',
        width: store.maximized ? '100vw' : w + 'px',
        height: store.maximized ? '100vh' : h + 'px',
        zIndex: store.zIndex,
      }"
      @pointerdown.capture="store.bringToFront()"
    >
      <!-- Title bar：─ 最小化 / □ 最大化（双击标题栏同效）/ ✕ 关闭，拖动标题栏移动窗口 -->
      <div
        ref="titlebarEl"
        class="rw-titlebar"
        @pointerdown="onDragStart"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
        @dblclick="onTitleDblClick"
      >
        <button class="rw-btn rw-minimize" title="最小化" @click.stop="store.toggleMinimize()">─</button>
        <button class="rw-btn rw-maximize" :title="store.maximized ? '还原' : '最大化'" @click.stop="store.toggleMaximize()">□</button>
        <span class="rw-icon">📂</span>
        <span class="rw-title">Repo Browser: {{ repoName }}</span>
        <span class="rw-spacer" />
        <div class="toggle-switch" :class="{ on: store.gitMode }" @click="store.toggleGitMode()" title="Git 改动模式">
          <span class="toggle-label">{{ store.gitMode ? '🔀 Git' : '📋 全部' }}</span>
          <span class="toggle-knob"></span>
        </div>
        <button class="rw-btn rw-close" title="关闭 (Esc)" @click.stop="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="rw-body">
        <!-- Left: File tree -->
        <div class="tree-panel">
          <div
            ref="treeHScroll"
            class="tree-hscroll"
            title="横向拖动查看完整文件名"
            @scroll="onHScroll"
          >
            <div class="tree-hscroll-inner" :style="{ width: treeContentWidth + 'px' }"></div>
          </div>
          <div v-if="store.treeError" class="tree-error">{{ store.treeError }}</div>
          <div ref="treeScroll" class="tree-scroll" @scroll="onTreeScroll">
            <FileTreeNode
              v-if="store.repoId !== null"
              :repoId="store.repoId"
              subPath=""
              :entries="store.getEntries('')"
              :depth="0"
            />
          </div>
        </div>

        <!-- Right: Preview -->
        <div class="preview-panel">
          <!-- Toolbar with breadcrumb & path -->
          <div class="preview-toolbar">
            <span v-if="store.selectedFilePath" class="file-path">
              <template v-for="(seg, idx) in store.selectedFilePath.split('/')" :key="idx">
                <span class="bread-sep" v-if="idx > 0">›</span>
                <span class="bread-seg" :class="{ active: idx === store.selectedFilePath.split('/').length - 1 }">{{ seg }}</span>
              </template>
              <span class="file-lang">{{ store.fileLang }}</span>
            </span>
            <span v-else class="file-path dim">No file selected</span>
          </div>

          <!-- Preview content -->
          <div class="preview-content">
            <FilePreview />
          </div>

          <!-- Load more bar -->
          <div v-if="store.selectedFilePath && store.fileHasMore" class="load-more-bar">
            <div class="load-progress">
              <div class="progress-fill" :style="{ width: (store.loadedRatio * 100) + '%' }"></div>
            </div>
            <span class="load-text">Loaded {{ store.loadedKB }}KB / {{ store.totalKB }}KB</span>
            <button
              class="load-more-btn"
              :disabled="store.fileLoading"
              @click="store.loadMoreFile()"
            >
              {{ store.fileLoading ? '⏳ Loading...' : '▼ Load More' }}
            </button>
          </div>

          <!-- Load error -->
          <div v-if="store.fileError" class="file-error">{{ store.fileError }}</div>
        </div>
      </div>

    </div>
  </Teleport>
</template>

<style scoped>
/* ── 浮动窗口（无遮罩，可拖动，与终端窗口同一层级体系）── */
.repo-win {
  position: fixed;
  display: flex; flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 60px rgba(0,0,0,0.5);
  overflow: hidden;
  animation: scaleIn 0.15s ease;
}
.repo-win.dragging { cursor: move; }
.repo-win.maximized { border-radius: 0; border: none; }
@keyframes scaleIn { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* ── Title bar ─────────────────────────────────────────── */
.rw-titlebar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.2);
  flex-shrink: 0;
  cursor: move;
  user-select: none;   /* 仅标题栏防拖拽误选，正文可正常选中复制 */
}
.rw-icon { font-size: 13px; }
.rw-title {
  font-size: 12px; font-weight: 600;
  color: var(--text); letter-spacing: 0.04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rw-spacer { flex: 1; }
.rw-btn {
  width: 24px; height: 24px; border: none; border-radius: 4px;
  background: transparent; color: var(--text-dim); font-size: 14px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  line-height: 1; flex-shrink: 0;
  transition: all 0.15s;
}
.rw-btn:hover { background: rgba(255,255,255,0.1); color: var(--text); }
.rw-maximize:hover { background: rgba(242,204,96,0.15); color: #f2cc60; }
.rw-close:hover { background: var(--danger); color: #fff; }

.toggle-switch {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 4px; border-radius: 16px;
  background: var(--border); cursor: pointer;
  position: relative; transition: background 0.2s;
  user-select: none; min-width: 100px;
}
.toggle-switch.on { background: rgba(242,204,96,0.25); }
.toggle-label {
  font-size: 10px; color: var(--text-dim); padding: 2px 6px;
  z-index: 1; transition: margin 0.2s; white-space: nowrap;
}
.toggle-switch.on .toggle-label { color: #f2cc60; margin-left: 20px; }
.toggle-knob {
  position: absolute; left: 2px; width: 22px; height: 18px;
  border-radius: 12px; background: var(--text-dim);
  transition: left 0.2s; top: 50%; transform: translateY(-50%);
}
.toggle-switch.on .toggle-knob { left: calc(100% - 24px); background: #f2cc60; }

/* ── Body ────────────────────────────────────────────── */
.rw-body {
  display: flex; flex-direction: row; flex: 1; min-height: 0;
}

/* ── Tree panel (left) ──────────────────────────────── */
.tree-panel {
  width: 320px; min-width: 280px;
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  background: rgba(0,0,0,0.1);
}
.tree-scroll {
  flex: 1; overflow: auto;
}
.tree-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
.tree-scroll::-webkit-scrollbar-track { background: transparent; }
.tree-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── 顶部横向滚动条: 树内容过宽时在此横向拖动, 与树区域同步 ── */
.tree-hscroll {
  flex-shrink: 0;
  height: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  background: rgba(0,0,0,0.25);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  scrollbar-width: thin;
}
.tree-hscroll::-webkit-scrollbar { height: 8px; }
.tree-hscroll::-webkit-scrollbar-track { background: transparent; }
.tree-hscroll::-webkit-scrollbar-thumb { background: var(--text-dim); border-radius: 4px; }
.tree-hscroll::-webkit-scrollbar-thumb:hover { background: var(--glow-dim); }
.tree-hscroll-inner { height: 1px; }
.tree-error {
  padding: 20px; font-size: 11px; color: var(--danger); text-align: center;
}

/* ── Preview panel (right) ──────────────────────────── */
.preview-panel {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.preview-toolbar {
  display: flex; align-items: center;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.12);
  flex-shrink: 0; min-height: 32px;
}
.file-path {
  font-size: 10px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  display: flex; align-items: center; gap: 1px;
}
.file-path.dim { color: var(--text-dim); }
.bread-sep { color: var(--text-dim); margin: 0 3px; flex-shrink: 0; }
.bread-seg { flex-shrink: 0; }
.bread-seg.active { color: var(--glow); font-weight: 600; }
.file-lang {
  margin-left: 10px; flex-shrink: 0;
  font-size: 9px; color: var(--text-dim);
  background: rgba(34,238,102,0.08); padding: 1px 6px;
  border-radius: 3px; text-transform: uppercase;
}

.preview-content {
  flex: 1; overflow: hidden; min-height: 0;
}

/* ── Load more bar ──────────────────────────────────── */
.load-more-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  background: rgba(0,0,0,0.15);
  flex-shrink: 0;
}
.load-progress {
  flex: 1; height: 4px;
  background: var(--border); border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%; background: var(--glow-dim);
  border-radius: 2px; transition: width 0.3s;
}
.load-text {
  font-size: 9px; color: var(--text-dim);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.load-more-btn {
  font-family: var(--font); font-size: 10px;
  padding: 4px 14px;
  background: transparent; color: var(--glow);
  border: 1px solid var(--glow-dim); border-radius: var(--radius);
  cursor: pointer; white-space: nowrap;
  transition: all 0.15s;
}
.load-more-btn:hover:not(:disabled) { background: rgba(34,238,102,0.08); border-color: var(--glow); }
.load-more-btn:disabled { opacity: 0.5; cursor: default; }

.file-error {
  padding: 8px 16px; font-size: 10px; color: var(--danger);
  border-top: 1px solid var(--border); flex-shrink: 0;
}
</style>
