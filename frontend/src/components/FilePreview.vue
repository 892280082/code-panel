<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import { highlightLines } from '@/utils/highlight'
import { parseRawDiffHunks, mergeToUnified } from '@/utils/diff'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useCopyFeedback } from '@/composables/useCopyFeedback'
import HistoryPanel from './HistoryPanel.vue'

const store = useRepoBrowserStore()

// ── Syntax highlighting ───────────────────────────────────


// ── Markdown render ─────────────────────────────────────

function renderMarkdown(text: string): string {
  try { return marked.parse(text) as string } catch { return text }
}

// ── Unified line view ─────────────────────────────────────
//    全文 + diff hunks → VSCode 式内联行(解析/合并/高亮统一走 utils)

interface UnifiedLine {
  text: string
  type: 'ctx' | 'add' | 'del'
  lineNum: number | null    // new file line number (null for deleted lines)
  oldLineNum: number | null
  html: string              // syntax-highlighted
}

const showInlineDiff = ref(true)   // true = inline diff, false = pure source

const unifiedLines = computed<UnifiedLine[]>(() => {
  const sourceText = store.fileContent
  const diff = store.diffLines
  const filePath = store.selectedFilePath || ''
  if (!sourceText) return []

  const sourceLines = sourceText.split('\n')
  const hunks = parseRawDiffHunks(diff)
  const merged = mergeToUnified(sourceLines, hunks)

  // 批量语法高亮(删除行不参与 bulk,html 留空;按下标回填避免改写共享类型)
  const idxs = merged.map((l, i) => ({ l, i })).filter(x => x.l.type !== 'deletion')
  const htmls = highlightLines(idxs.map(x => x.l.content), filePath)
  const htmlByIdx = new Map<number, string>()
  idxs.forEach((x, j) => htmlByIdx.set(x.i, htmls[j] ?? ''))

  return merged.map((l, i) => ({
    text: l.content,
    type: (l.type === 'addition' ? 'add' : l.type === 'deletion' ? 'del' : 'ctx') as UnifiedLine['type'],
    lineNum: l.newLine ?? null,
    oldLineNum: l.oldLine ?? null,
    html: htmlByIdx.get(i) ?? '',
  }))
})

const renderMode = computed<'empty' | 'binary' | 'markdown' | 'code' | 'history'>(() => {
  if (!store.selectedFilePath) return 'empty'
  if (store.viewMode === 'history') return 'history'
  if (store.fileBinary) return 'binary'
  if (store.selectedFilePath.endsWith('.md') || store.selectedFilePath.endsWith('.mdx')) return 'markdown'
  return 'code'
})

const renderedMarkdown = computed(() =>
  renderMode.value === 'markdown' ? renderMarkdown(store.fileContent) : ''
)

// ── 复制：文件路径 + 内容（有选区复制选区，无选区复制全文）──
const { copied, copy } = useCopyFeedback(1600)
let lastCopyAt = 0

function copyFormatted() {
  // mousedown.prevent（保选区）+ click 双绑定会触发两次 → 同一时刻只执行一次
  const now = Date.now()
  if (now - lastCopyAt < 400) return
  lastCopyAt = now

  const path = store.selectedFilePath || ''
  const selection = window.getSelection()?.toString().trim() || ''
  const body = selection || store.fileContent
  copy(`文件：${path}\n内容：\n${body}`)
}

// ── Scroll-to-top on file switch ────────────────────────

const previewRef = ref<HTMLElement | null>(null)
watch(() => store.selectedFilePath, () => {
  if (previewRef.value) previewRef.value.scrollTop = 0
})
</script>

<template>
  <div class="preview-container" ref="previewRef">
    <!-- View mode toolbar -->
    <div v-if="store.selectedFilePath && !store.fileBinary" class="view-mode-bar">
      <button
        class="mode-btn"
        :class="{ active: store.viewMode === 'preview' }"
        @click="store.switchToPreview()"
      >📄 预览</button>
      <button
        class="mode-btn"
        :class="{ active: store.viewMode === 'history' }"
        @click="store.switchToHistory()"
      >🕒 历史</button>
      <span v-if="store.viewMode === 'history' && store.fileHistory.length" class="history-count">
        {{ store.fileHistory.length }} 次提交
      </span>
      <span class="mode-bar-spacer" />
      <button
        class="mode-btn copy-btn"
        :class="{ copied }"
        :title="`复制文件路径与内容${store.fileContent ? '（有选区复制选区，无选区复制全文）' : ''}`"
        @mousedown.prevent="copyFormatted"
        @click="copyFormatted"
      >{{ copied ? '✓ 已复制' : '📋 复制' }}</button>
    </div>

    <!-- Empty state -->
    <div v-if="renderMode === 'empty'" class="empty-state">
      <span class="empty-icon">📂</span>
      <span>Select a file from the tree to preview</span>
    </div>

    <!-- Binary file -->
    <div v-else-if="renderMode === 'binary'" class="binary-state">
      <span class="binary-icon">📎</span>
      <span class="binary-title">Binary file</span>
      <span class="binary-size">{{ store.totalKB }}KB — cannot preview in browser</span>
    </div>

    <!-- Markdown preview -->
    <div v-else-if="renderMode === 'markdown'" class="md-preview md-body">
      <div v-html="renderedMarkdown"></div>
    </div>

    <!-- History panel (extracted component) -->
    <HistoryPanel v-else-if="renderMode === 'history'" />

    <!-- Code preview: unified diff view -->
    <div v-else class="code-preview hljs-dark">
      <!-- Diff toggle bar -->
      <div v-if="store.diffLines.length > 0" class="diff-toggle-bar">
        <button
          class="diff-toggle-btn"
          :class="{ active: showInlineDiff }"
          @click="showInlineDiff = !showInlineDiff"
        >
          {{ showInlineDiff ? '🔀 内联对比' : '📝 纯源码' }}
        </button>
        <span class="toggle-hint" v-if="store.diffLines.length > 0">
          {{ showInlineDiff ? '已改动行高亮显示' : '点击切换内联对比视图' }}
        </span>
      </div>

      <!-- Unified diff code view -->
      <div class="unified-code">
        <div
          v-for="(line, i) in unifiedLines"
          :key="i"
          class="unified-line"
          :class="'line-' + line.type"
        >
          <!-- Gutter -->
          <span class="line-gutter">
            <span v-if="line.type === 'add'" class="gutter-sign add-sign">+</span>
            <span v-else-if="line.type === 'del'" class="gutter-sign del-sign">−</span>
            <span v-else class="gutter-num">{{ line.lineNum }}</span>
          </span>
          <!-- Content -->
          <span v-if="line.type !== 'del'" class="line-text" v-html="line.html"></span>
          <span v-else class="line-text del-text">{{ line.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* ── highlight.js github-dark theme (inline) ─────────── */
.hljs-dark .hljs { color: #c9d1d9; background: #0d1117 }
.hljs-dark .hljs-doctag,.hljs-dark .hljs-keyword,.hljs-dark .hljs-meta .hljs-keyword,.hljs-dark .hljs-template-tag,.hljs-dark .hljs-template-variable,.hljs-dark .hljs-type,.hljs-dark .hljs-variable.language_ { color: #ff7b72 }
.hljs-dark .hljs-title,.hljs-dark .hljs-title.class_,.hljs-dark .hljs-title.class_.inherited__,.hljs-dark .hljs-title.function_ { color: #d2a8ff }
.hljs-dark .hljs-attr,.hljs-dark .hljs-attribute,.hljs-dark .hljs-literal,.hljs-dark .hljs-meta,.hljs-dark .hljs-number,.hljs-dark .hljs-operator,.hljs-dark .hljs-selector-attr,.hljs-dark .hljs-selector-class,.hljs-dark .hljs-selector-id,.hljs-dark .hljs-variable { color: #79c0ff }
.hljs-dark .hljs-meta .hljs-string,.hljs-dark .hljs-regexp,.hljs-dark .hljs-string { color: #a5d6ff }
.hljs-dark .hljs-built_in,.hljs-dark .hljs-symbol { color: #ffa657 }
.hljs-dark .hljs-code,.hljs-dark .hljs-comment,.hljs-dark .hljs-formula { color: #8b949e }
.hljs-dark .hljs-name,.hljs-dark .hljs-quote,.hljs-dark .hljs-selector-pseudo,.hljs-dark .hljs-selector-tag { color: #7ee787 }
.hljs-dark .hljs-subst { color: #c9d1d9 }
.hljs-dark .hljs-section { color: #1f6feb; font-weight: 700 }
.hljs-dark .hljs-bullet { color: #f2cc60 }
.hljs-dark .hljs-emphasis { color: #c9d1d9; font-style: italic }
.hljs-dark .hljs-strong { color: #c9d1d9; font-weight: 700 }
.hljs-dark .hljs-addition { color: #aff5b4; background-color: #033a16 }
.hljs-dark .hljs-deletion { color: #ffdcd7; background-color: #67060c }
</style>

<style scoped>
.preview-container { height: 100%; overflow-y: auto; }
.preview-container::-webkit-scrollbar { width: 6px; }
.preview-container::-webkit-scrollbar-track { background: transparent; }
.preview-container::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }

.empty-state, .binary-state {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100%; color: var(--text-dim); font-size: 12px; gap: 8px;
}
.empty-icon, .binary-icon { font-size: 48px; opacity: 0.3; }
.binary-title { color: var(--text); font-weight: 600; }
.binary-size { font-size: 10px; }

.md-preview { padding: 20px 24px; line-height: 1.7; }

.code-preview {
  height: 100%; overflow: auto;
  display: flex; flex-direction: column;
}

.diff-toggle-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.1);
  flex-shrink: 0;
}
.diff-toggle-btn {
  font-family: var(--font); font-size: 10px; padding: 3px 10px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
}
.diff-toggle-btn:hover { color: var(--text); border-color: var(--text-dim); }
.diff-toggle-btn.active { color: #f2cc60; border-color: rgba(242,204,96,0.4); background: rgba(242,204,96,0.08); }
.toggle-hint { font-size: 10px; color: var(--text-dim); }

/* ── Unified code lines ────────────────────────────────── */
.unified-code {
  flex: 1; overflow: auto;
  font-family: var(--font); font-size: 11px; line-height: 1.55;
}
.unified-line {
  display: flex; min-height: 21px;
  border-bottom: 1px solid rgba(var(--line-rgb),0.15);
}
.unified-line:last-child { border-bottom: none; }

/* Gutter */
.line-gutter {
  width: 56px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: flex-end;
  padding: 0 8px;
  border-right: 1px solid rgba(var(--line-rgb),0.3);
  user-select: none;
  background: rgba(0,0,0,0.2);
}
.gutter-num {
  font-size: 10px; color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.gutter-sign {
  font-size: 12px; font-weight: 700; padding-right: 4px;
}
.add-sign { color: var(--glow); }
.del-sign { color: var(--danger); }

/* Line text */
.line-text {
  flex: 1; padding: 1px 12px;
  white-space: pre; overflow-x: auto;
  font-variant-ligatures: none;
}

/* ── Line states ───────────────────────────────────────── */
.line-ctx { background: var(--bg); }
.line-ctx .line-text { color: var(--text); }

.line-add { background: rgba(var(--glow-rgb),0.08); }
.line-add .line-gutter { background: rgba(var(--glow-rgb),0.12); border-right-color: rgba(var(--glow-rgb),0.2); }
.line-add .line-text { color: #9aefb8; }

.line-del { background: rgba(var(--danger-rgb),0.08); }
.line-del .line-gutter { background: rgba(var(--danger-rgb),0.12); border-right-color: rgba(var(--danger-rgb),0.2); }
.line-del .line-text { color: #f09999; }
.del-text { text-decoration: line-through; }

/* ── View mode bar ───────────────────────────────────────── */
.view-mode-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.12);
  flex-shrink: 0;
}
.mode-btn {
  font-family: var(--font); font-size: 10px; padding: 4px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
  /* 覆盖全局同名 .mode-btn（需求类型按钮：width:100% + column 布局），
     否则复制按钮会被拉满整行 */
  width: auto; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  white-space: nowrap;
}
.mode-btn:hover { color: var(--text); border-color: var(--text-dim); }
.mode-btn.active { color: var(--glow); border-color: var(--glow-dim); background: rgba(var(--glow-rgb),0.08); }
.mode-bar-spacer { flex: 1; }
.copy-btn { margin-left: auto; flex-shrink: 0; }
.copy-btn:hover { color: #f2cc60; border-color: rgba(242,204,96,0.4); }
.copy-btn.copied { color: var(--glow); border-color: var(--glow); background: rgba(var(--glow-rgb),0.1); }
.history-count {
  margin-left: auto; font-size: 10px; color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

</style>
