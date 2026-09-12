<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useGitStore, gitPullStatusIcon, gitFormatLogTime } from '@/stores/git'
import { useProjectsStore } from '@/stores/projects'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import TopRightTools from '@/components/TopRightTools.vue'
import { useCopySelection } from '@/composables/useCopySelection'
import { copyToClipboard } from '@/utils/clipboard'
import { highlightLines } from '@/utils/highlight'
import { mergeToUnified, buildDiffBlocks, type UnifiedLine } from '@/utils/diff'
import { useFileTree } from '@/composables/useFileTree'
import Sidebar from '@/components/Sidebar.vue'
import StatusDot from '@/components/StatusDot.vue'
import DiffOverviewRuler from '@/components/DiffOverviewRuler.vue'

const store = useGitStore()
const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)
const browser = useRepoBrowserStore()
const currentFilePath = () => store.selectedFile || ''

const { showCopy, copyLeft, copyTop, doCopy } = useCopySelection(currentFilePath)

// ── Keyboard navigation ──────────────────────────────────
const fileListRef = ref<HTMLElement | null>(null)
const diffScrollRef = ref<HTMLElement | null>(null)   // 概览条跳转的滚动容器
const currentFileList = computed(() => store.diffResult?.files ?? [])

// ── 变动模式:整个文件 + 高亮变动行(解析/合并统一在 utils/diff)──
const unifiedDiffLines = computed<UnifiedLine[]>(() => {
  const f = store.diffResult?.files.find(x => x.path === store.selectedFile)
  if (!f) return []
  // 源码未加载(删除的文件/加载失败)→ 退化为纯 hunk 片段
  if (!store.fileSource) return f.hunks.flatMap(h => h.lines)   // 退化为纯 hunk 片段(删除文件等)
  return mergeToUnified(store.fileSource.split('\n'), f.hunks)
})

function handleFileKeydown(e: KeyboardEvent) {
  const files = currentFileList.value
  if (!files.length) return

  const idx = files.findIndex(f => f.path === store.selectedFile)

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = idx < 0 ? 0 : Math.min(idx + 1, files.length - 1)
    store.navigateToFile(files[next].path)
    loadSourceFor(files[next].path)
    scrollSelectedIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const prev = idx < 0 ? files.length - 1 : Math.max(idx - 1, 0)
    store.navigateToFile(files[prev].path)
    loadSourceFor(files[prev].path)
    scrollSelectedIntoView()
  }
}

function scrollSelectedIntoView() {
  nextTick(() => {
    fileListRef.value?.querySelector('.file-row.selected')?.scrollIntoView({ block: 'nearest' })
  })
}

// ── 层级树(GitHub 式压缩) / 概览条 / 语法高亮:统一走共享模块 ──
const { visibleRows: visibleFileRows, expandedDirs, toggleDir } =
  useFileTree(computed(() => store.diffResult?.files ?? []))

const highlightedDiffHtml = computed<string[]>(() => {
  const lines = unifiedDiffLines.value
  if (!lines.length || !store.selectedFile) return []
  return highlightLines(lines.map(l => l.content), store.selectedFile)
})
const highlightedSourceHtml = computed<string[]>(() => {
  if (!store.fileSource || !store.selectedFile) return []
  return highlightLines(store.fileSource.split('\n'), store.selectedFile)
})
const diffBlocks = computed(() => buildDiffBlocks(unifiedDiffLines.value))
const onRulerJump = (ratio: number) => {
  const sc = diffScrollRef.value
  if (!sc) return
  sc.scrollTop = ratio * sc.scrollHeight - sc.clientHeight / 2
}

onMounted(() => store.init())

const newRepoName = ref('')
const newRepoPath = ref('')

async function handleAdd() {
  try {
    await store.addRepo(newRepoName.value, newRepoPath.value)
    newRepoName.value = ''
    newRepoPath.value = ''
  } catch (e: any) { alert('添加失败: ' + e.message) }
}

function dotStatus(s: any) {
  if (!s || s.error) return 'dead'
  if (s.clean) return 'alive'
  return 'missing'  // yellow = has changes
}

function statusBadge(status?: string): string {
  return ({ added: '+', modified: '~', deleted: '−', renamed: '→' } as Record<string, string>)[status ?? ''] || '?'
}

function statusColor(status?: string): string {
  return ({ added: 'var(--glow)', modified: 'var(--warn)', deleted: 'var(--danger)', renamed: 'var(--info)' } as Record<string, string>)[status ?? ''] || 'var(--text-dim)'
}

function toggleViewMode(filePath: string) {
  if (store.viewMode === 'source') {
    store.viewMode = 'diff'
  } else {
    store.viewMode = 'source'
    store.loadFileSource(store.diffResult!.repoId, filePath)
  }
}

// 预载文件全文（变动模式 = 全文+高亮，需要 fileSource）
function loadSourceFor(path: string) {
  if (store.diffResult) store.loadFileSource(store.diffResult.repoId, path)
}

// 点文件：选中 + 预载全文
function onFileClick(path: string) {
  store.selectFile(path)
  if (store.selectedFile) loadSourceFor(path)
}

// ── Pull / Log helpers ──────────────────────────────────

function copyHash(hash: string) { copyToClipboard(hash) }

function switchToLog() {
  store.repoViewMode = 'log'
  // Load log for the currently expanded repo
  if (store.diffResult?.repoId) {
    store.loadLog(store.diffResult.repoId)
  }
}

</script>

<template>
  <div class="app">
    <!-- ═══════ SIDEBAR ═══════ -->
    <Sidebar>
      <!-- Repo list -->
      <div class="repo-scroll">
        <div v-if="!hasProject" class="empty">无项目,请先添加项目</div>
        <div v-else-if="!store.repos.length" class="empty">No git repos configured</div>
        <div
          v-for="r in store.repos" :key="r.id"
          class="repo-section"
        >
          <!-- Repo row -->
          <div
            class="repo-row"
            :class="{ selected: store.expandedRepos.has(r.id) }"
            @click="store.selectRepo(r.id)"
          >
            <StatusDot :status="dotStatus(store.summaries[r.id])" />
            <div class="repo-info">
              <span class="repo-name">{{ r.name }}</span>
              <span class="repo-branch">⎇ {{ store.summaries[r.id]?.branch || '...' }}</span>
            </div>
            <span
              v-if="store.summaries[r.id] && !store.summaries[r.id].clean"
              class="change-badge"
            >{{ store.summaries[r.id].fileCount }}</span>
            <button
              class="browse-btn"
              title="浏览仓库文件"
              @click.stop="browser.openModal(r.id, r.name, r.path)"
            >📂</button>
          </div>

          <!-- Files under expanded repo -->
          <div
            v-if="store.expandedRepos.has(r.id) && store.diffResult?.repoId === r.id"
            class="file-sublist"
            ref="fileListRef"
            tabindex="0"
            @keydown="handleFileKeydown"
          >
            <div v-if="store.diffResult.error" class="error-text">{{ store.diffResult.error }}</div>
            <div v-else-if="!store.diffResult.files.length" class="clean-text">✓ Working tree clean</div>
            <!-- 层级树:公共前缀目录压缩成单节点,从分叉处开始显示(VSCode 式) -->
            <template v-for="row in visibleFileRows" :key="row.node.key">
              <div
                v-if="row.type === 'dir'"
                class="dir-row"
                :style="{ paddingLeft: 8 + row.depth * 13 + 'px' }"
                :title="row.node.fullName"
                @click.stop="toggleDir(row.node.key)"
              >
                <span class="dir-arrow" :class="{ open: expandedDirs.has(row.node.key) }">▸</span>
                <span class="dir-icon">{{ expandedDirs.has(row.node.key) ? '📂' : '📁' }}</span>
                <span class="dir-name">{{ row.node.name }}</span>
              </div>
              <div
                v-else
                class="file-row"
                :class="{ selected: store.selectedFile === row.node.path }"
                :style="{ paddingLeft: 10 + row.depth * 13 + 'px' }"
                @click.stop="onFileClick(row.node.path)"
              >
                <span class="file-status" :style="{ color: statusColor(row.node.item?.status) }">{{ statusBadge(row.node.item?.status) }}</span>
                <span class="file-name" :title="row.node.fullName">{{ row.node.name }}</span>
                <span class="file-stat">
                  <span class="add">+{{ row.node.item?.additions }}</span>
                  <span class="del">−{{ row.node.item?.deletions }}</span>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Pull All -->
      <div v-if="store.repos.length" class="sync-section">
        <button
          class="sync-btn"
          :disabled="store.pulling"
          @click="store.pullAll()"
        >
          <span v-if="store.pulling">⟳ 同步中...</span>
          <span v-else>⟳ 一键同步 ({{ store.repos.length }} 仓库)</span>
        </button>
        <div v-if="store.pullResults.length" class="sync-results">
          <div
            v-for="r in store.pullResults" :key="r.repoId"
            class="sync-result-row"
            :class="r.status"
          >
            <span class="sync-status-icon">{{ gitPullStatusIcon(r.status) }}</span>
            <span class="sync-repo-name">{{ r.repoName }}</span>
            <span class="sync-msg">{{ r.message }}</span>
          </div>
        </div>
      </div>

      <!-- Add repo -->
      <div v-if="hasProject" class="add-section">
        <button class="add-btn" @click="store.showAddRepo = !store.showAddRepo">+ Add Repo</button>
        <div v-if="store.showAddRepo" class="add-form">
          <input v-model="newRepoName" placeholder="名称" class="input-sm" @keyup.enter="handleAdd" />
          <input v-model="newRepoPath" placeholder="路径" class="input-sm" @keyup.enter="handleAdd" />
          <button class="btn-sm btn-primary" @click="handleAdd">Add</button>
        </div>
      </div>
    </Sidebar>

    <!-- ═══════ MAIN ═══════ -->
    <main class="main">
      <!-- Toolbar -->
      <div class="toolbar">
        <button @click="store.refresh()" :disabled="store.loading">↻ Refresh</button>
        <template v-if="store.expandedRepos.size">
          <button
            :class="{ active: store.repoViewMode === 'diff' }"
            @click="store.repoViewMode = 'diff'"
          >Diff</button>
          <button
            :class="{ active: store.repoViewMode === 'log' }"
            @click="switchToLog()"
          >History</button>
        </template>
        <label class="staged-toggle">
          <input type="checkbox" v-model="store.showStaged" />
          <span>staged</span>
        </label>
        <span v-if="store.diffResult && !store.diffResult.error && store.repoViewMode === 'diff'" class="stat-summary">
          {{ store.diffResult.files.length }} files ·
          <span class="add">+{{ store.diffResult.files.reduce((s,f) => s+f.additions, 0) }}</span>
          <span class="del">−{{ store.diffResult.files.reduce((s,f) => s+f.deletions, 0) }}</span>
        </span>
        <span v-if="store.diffResult?.error" class="error-text">{{ store.diffResult.error }}</span>
        <TopRightTools class="trtr" />
      </div>

      <!-- Content -->
      <div class="diff-area">
        <!-- Log View -->
        <div v-if="store.repoViewMode === 'log' && store.diffResult" class="log-scroll">
          <div v-if="store.logLoading" class="loading-text">加载中...</div>
          <template v-else-if="store.logResult && !store.logResult.error">
            <div class="log-header">
              <span class="log-branch">⎇ {{ store.logResult.branch }}</span>
              <span class="log-count">{{ store.logResult.totalCommits }} commits</span>
            </div>
            <div v-for="group in store.logResult.dayGroups" :key="group.date" class="log-day-group">
              <div class="log-day-header">{{ group.date }}</div>
              <div
                v-for="commit in group.commits" :key="commit.hash"
                class="log-commit"
                @click="copyHash(commit.hash)"
                :title="'点击复制: ' + commit.hash"
              >
                <span class="log-commit-hash">{{ commit.hash.slice(0, 7) }}</span>
                <span class="log-commit-subject">{{ commit.subject }}</span>
                <span class="log-commit-meta">
                  <span class="log-commit-author">{{ commit.author }}</span>
                  <span class="log-commit-time">{{ gitFormatLogTime(commit.date) }}</span>
                </span>
              </div>
            </div>
            <div v-if="!store.logResult.dayGroups.length" class="empty-state hint-state">
              <span>No commits found</span>
            </div>
          </template>
          <div v-else-if="store.logResult?.error" class="error-text pad">{{ store.logResult.error }}</div>
        </div>

        <!-- Diff View -->
        <template v-if="store.repoViewMode === 'diff'">
        <!-- Empty -->
        <div v-if="!hasProject" class="empty-state">
          <span class="icon">⎇</span>
          <span>还没有项目,请先在侧栏「项目」添加一个项目</span>
        </div>
        <div v-else-if="!store.expandedRepos.size" class="empty-state">
          <span class="icon">⎇</span>
          <span>Select a repository from the sidebar</span>
        </div>

        <!-- File detail: show diff hunks or source -->
        <template v-if="store.selectedFile && store.diffResult">
          <template v-for="f in store.diffResult.files.filter(x => x.path === store.selectedFile)" :key="f.path">
            <div class="diff-file-header">
              <span class="diff-file-path">{{ f.path }}</span>
              <div class="diff-file-actions">
                <button
                  class="view-toggle-btn"
                  @click="toggleViewMode(f.path)"
                >
                  {{ store.viewMode === 'diff' ? '📄 源码' : '📊 变动' }}
                </button>
                <span v-if="store.viewMode === 'diff'" class="diff-file-stat">
                  <span class="add">+{{ f.additions }}</span>
                  <span class="del">−{{ f.deletions }}</span>
                </span>
              </div>
            </div>

            <!-- Diff mode：整个文件 + 高亮变动行 + 右侧概览条(VSCode minimap ruler) -->
            <div v-if="store.viewMode === 'diff'" class="diff-body">
              <div class="diff-scroll" ref="diffScrollRef">
                <div class="diff-file hljs-dark">
                  <div
                    v-for="(line, li) in unifiedDiffLines" :key="li"
                    class="diff-line"
                    :class="'line-' + line.type"
                  >
                    <span class="line-num old-num">{{ line.oldLine ?? '' }}</span>
                    <span class="line-num new-num">{{ line.newLine ?? '' }}</span>
                    <span class="line-sign">{{ line.type === 'addition' ? '+' : line.type === 'deletion' ? '−' : ' ' }}</span>
                    <span class="line-content" v-html="highlightedDiffHtml[li] ?? ''" />
                  </div>
                </div>
              </div>
              <!-- 概览条(组件):绿块=新增 红块=删除,点击/拖动跳转 -->
              <DiffOverviewRuler :blocks="diffBlocks" :target="diffScrollRef" />
            </div>

            <!-- Source mode:整文件纯流式,变动行保留底色 + 语法着色 -->
            <div v-else class="source-scroll">
              <div v-if="store.sourceLoading" class="loading-text">加载中...</div>
              <div v-else class="source-file hljs-dark">
                <div
                  v-for="(line, li) in unifiedDiffLines" :key="li"
                  class="source-line"
                  :class="{ 'src-add': line.type === 'addition', 'src-del': line.type === 'deletion' }"
                ><span class="line-content" v-html="highlightedSourceHtml[li] ?? ''" /></div>
              </div>
            </div>
          </template>
        </template>

        <!-- Repo selected but no file: show stat overview -->
        <div v-else-if="store.diffResult && !store.diffResult.error && store.diffResult.files.length" class="diff-scroll">
          <div class="stat-block">
            <div class="stat-block-header">git diff --stat</div>
            <pre class="stat-pre">{{ store.diffResult.stat || '(no output)' }}</pre>
          </div>
          <div class="empty-state hint-state">
            <span>Select a file from the sidebar to view diff</span>
          </div>
        </div>
        </template>
      </div>
    </main>

    <!-- Floating copy button -->
    <Teleport to="body">
      <button
        v-if="showCopy"
        class="copy-float"
        :style="{ left: copyLeft + 'px', top: copyTop + 'px' }"
        @click="doCopy"
      >📋 复制</button>
    </Teleport>
  </div>
</template>

<style scoped>
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

/* ── Sidebar repo list ──────────────────────────────── */
/* 分组选择（复用日志分组下拉样式） */
.repo-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.repo-scroll::-webkit-scrollbar { width: 4px; }
.repo-scroll::-webkit-scrollbar-track { background: transparent; }
.repo-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.empty { padding: 20px 12px; font-size: 11px; color: var(--text-dim); text-align: center; }

.repo-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
  border-bottom: 1px solid rgba(35,35,42,0.3);
  transition: background 0.15s;
}
.repo-row:hover { background: #1a1a22; }
.repo-row.selected { background: #1a1a28; border-left: 2px solid var(--glow-dim); }

.repo-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.repo-name { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repo-branch { font-size: 9px; color: var(--text-dim); }

.change-badge {
  background: var(--warn); color: #000; font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
  min-width: 18px; text-align: center;
}
.browse-btn {
  font-size: 14px; padding: 2px 6px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; flex-shrink: 0; line-height: 1;
  transition: all 0.15s;
  margin-left: 4px;
}
.browse-btn:hover { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

/* Files under expanded repo */
.file-sublist {
  background: rgba(0,0,0,0.15);
  border-bottom: 1px solid var(--border);
  outline: none;
}
.file-sublist:focus { outline: 1px solid var(--glow-dim); outline-offset: -1px; }
.file-row {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 12px 4px 28px;
  font-size: 11px; cursor: pointer;
  border-bottom: 1px solid rgba(35,35,42,0.15);
}
.file-row:hover { background: rgba(34,238,102,0.04); }
.file-row.selected { background: rgba(34,238,102,0.08); }
.file-status { font-weight: 700; font-size: 11px; width: 14px; flex-shrink: 0; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
/* 层级树目录行 */
.dir-row {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 8px; cursor: pointer; user-select: none;
  font-size: 11px; color: var(--t2, #8b8b96);
  border-radius: 4px;
}
.dir-row:hover { background: rgba(255,255,255,0.05); color: var(--text); }
.dir-arrow { display: inline-block; font-size: 9px; transition: transform 0.15s; flex: none; }
.dir-arrow.open { transform: rotate(90deg); }
.dir-icon { font-size: 11px; flex: none; }
.dir-name { flex: 1; white-space: nowrap; }
/* GitHub 树感:行内容不换行不截断,容器横向可滑动 */
.file-sublist { overflow-x: auto; }
.file-sublist .file-row, .file-sublist .dir-row { min-width: max-content; padding-right: 12px; }
.file-sublist .file-row .file-name { white-space: nowrap; text-overflow: clip; overflow: visible; }
.file-stat { display: flex; gap: 6px; font-size: 10px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.add { color: var(--glow); }
.del { color: var(--danger); }
.error-text { padding: 8px 12px; font-size: 10px; color: var(--danger); }
.clean-text { padding: 8px 12px 8px 28px; font-size: 10px; color: var(--glow); }

/* Add repo */
.add-section {
  border-top: 1px solid var(--border);
  padding: 6px 12px;
}
.add-btn {
  width: 100%; padding: 6px;
  font-family: var(--font); font-size: 10px;
  background: transparent; color: var(--text-dim);
  border: 1px dashed var(--border); border-radius: var(--radius);
  cursor: pointer;
}
.add-btn:hover { color: var(--text); border-color: var(--glow-dim); }
.add-form {
  display: flex; flex-direction: column; gap: 4px; margin-top: 6px;
}
.input-sm {
  padding: 5px 8px; font-family: var(--font); font-size: 10px;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: var(--radius); outline: none;
}
.input-sm:focus { border-color: var(--glow-dim); }
.btn-sm {
  font-family: var(--font); font-size: 10px; padding: 4px 10px;
  border-radius: var(--radius); cursor: pointer;
}
.btn-primary { background: var(--glow-dim); color: var(--text); border: 1px solid var(--glow); }

/* ── Toolbar ─────────────────────────────────────────── */
.toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar button { height: 26px; padding-top: 0; padding-bottom: 0; box-sizing: border-box; }
.toolbar .trtr { margin-left: auto; }
.toolbar button {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px; background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer;
}
.toolbar button:hover:not(:disabled) { color: var(--text); border-color: var(--glow-dim); }
.staged-toggle { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-dim); cursor: pointer; }
.staged-toggle input { accent-color: var(--glow); }
.stat-summary { margin-left: auto; font-size: 11px; color: var(--text-dim); }

/* ── Diff area ───────────────────────────────────────── */
.diff-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
/* diff 内容区 + 右侧概览条(横排;概览条占满视口高) */
.diff-body { flex: 1; display: flex; min-height: 0; }
.diff-scroll { flex: 1; overflow-y: auto; }

.diff-scroll::-webkit-scrollbar { width: 6px; }
.diff-scroll::-webkit-scrollbar-track { background: transparent; }
.diff-scroll::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }

.empty-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--text-dim); font-size: 12px; gap: 8px;
}
.empty-state .icon { font-size: 48px; opacity: 0.3; }
.hint-state { flex: 0; padding: 40px; }

.stat-block { padding: 16px 20px; }
.stat-block-header {
  font-size: 10px; color: var(--text-dim);
  margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.08em;
}
.stat-pre {
  font-family: var(--font); font-size: 12px; line-height: 1.6;
  color: var(--text); white-space: pre-wrap;
}

/* ── Diff file ───────────────────────────────────────── */
.diff-file { }
.diff-file-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 20px; background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 5;
}
.diff-file-path { font-size: 12px; color: var(--text); font-weight: 500; }
.diff-file-actions { display: flex; align-items: center; gap: 10px; }
.diff-file-stat { display: flex; gap: 12px; font-size: 10px; }
.view-toggle-btn {
  font-family: var(--font); font-size: 10px;
  padding: 3px 10px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
}
.view-toggle-btn:hover { color: var(--text); border-color: var(--glow-dim); }

/* Source view */
.source-scroll {
  flex: 1; overflow-y: auto;
}
.source-scroll::-webkit-scrollbar { width: 6px; }
.source-scroll::-webkit-scrollbar-track { background: transparent; }
.source-scroll::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }
.loading-text {
  padding: 20px; font-size: 12px; color: var(--text-dim); text-align: center;
}
.diff-line { display: flex; min-height: 21px; border-bottom: 1px solid rgba(35,35,42,0.2); }
.line-num {
  width: 48px; flex-shrink: 0; text-align: right;
  padding: 1px 8px; font-size: 10px; color: var(--text-dim);
  user-select: none; border-right: 1px solid rgba(35,35,42,0.3);
}
.line-sign { width: 20px; flex-shrink: 0; text-align: center; font-weight: 700; user-select: none; }
.line-content { flex: 1; padding: 1px 12px; white-space: pre; overflow-x: auto; font-variant-ligatures: none; }

/* 源码模式:无行号/符号,仅变动行着色 */
.source-file { font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.5; }
.source-line { padding: 0 10px; white-space: pre-wrap; word-break: break-all; }
.source-line.src-add { background: rgba(34,238,102,0.08); }
.source-line.src-add .line-content { color: #9aefb8; }
.source-line.src-del { background: rgba(244,71,71,0.10); }
.source-line.src-del .line-content { color: #f09999; text-decoration: line-through; opacity: .75; }

/* ── Sync section ──────────────────────────────────────── */
.sync-section {
  border-top: 1px solid var(--border);
  padding: 6px 12px;
}
.sync-btn {
  width: 100%; padding: 7px;
  font-family: var(--font); font-size: 11px;
  background: rgba(34,238,102,0.08); color: var(--glow);
  border: 1px solid var(--glow-dim); border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
}
.sync-btn:hover:not(:disabled) { background: rgba(34,238,102,0.14); }
.sync-btn:disabled { opacity: 0.5; cursor: wait; }
.sync-results {
  margin-top: 4px; max-height: 160px; overflow-y: auto;
}
.sync-results::-webkit-scrollbar { width: 3px; }
.sync-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.sync-result-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 4px; font-size: 10px;
  border-bottom: 1px solid rgba(35,35,42,0.2);
}
.sync-result-row:last-child { border-bottom: none; }
.sync-result-row.pulled .sync-status-icon { color: var(--glow); }
.sync-result-row.up-to-date .sync-status-icon { color: var(--glow-dim); }
.sync-result-row.no-remote .sync-status-icon { color: var(--text-dim); }
.sync-result-row.conflict .sync-status-icon { color: var(--danger); font-weight: 700; }
.sync-result-row.error .sync-status-icon { color: var(--danger); }
.sync-status-icon { width: 14px; flex-shrink: 0; font-weight: 700; text-align: center; }
.sync-repo-name {
  color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100px; flex-shrink: 0;
}
.sync-msg { color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Toolbar active button ────────────────────────────── */
.toolbar button.active {
  color: var(--glow); border-color: var(--glow-dim);
  background: rgba(34,238,102,0.08);
}

/* ── Log view ──────────────────────────────────────────── */
.log-scroll {
  flex: 1; overflow-y: auto;
}
.log-scroll::-webkit-scrollbar { width: 6px; }
.log-scroll::-webkit-scrollbar-track { background: transparent; }
.log-scroll::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 3px; }
.log-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px;
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.log-branch { font-size: 12px; color: var(--text-dim); }
.log-count { font-size: 10px; color: var(--text-dim); }
.log-day-group { }
.log-day-header {
  padding: 8px 20px; font-size: 10px; color: var(--text-dim);
  background: rgba(35,35,42,0.3);
  border-bottom: 1px solid rgba(35,35,42,0.5);
  font-family: var(--font); text-transform: uppercase; letter-spacing: 0.05em;
  position: sticky; top: 0; z-index: 2;
}
.log-commit {
  display: flex; align-items: baseline; gap: 12px;
  padding: 8px 20px; font-size: 12px;
  border-bottom: 1px solid rgba(35,35,42,0.2);
  cursor: pointer; transition: background 0.1s;
}
.log-commit:hover { background: rgba(34,238,102,0.04); }
.log-commit-hash {
  font-family: var(--font); font-size: 10px;
  color: var(--glow-dim); flex-shrink: 0; width: 56px;
  user-select: all;
}
.log-commit-subject {
  flex: 1; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.log-commit-meta {
  display: flex; gap: 12px; flex-shrink: 0;
  font-size: 10px; color: var(--text-dim);
}
.log-commit-author { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-commit-time { font-variant-numeric: tabular-nums; }
.error-text.pad { padding: 20px; }
.loading-text { padding: 20px; font-size: 12px; color: var(--text-dim); text-align: center; }

/* Floating copy button */
.copy-float {
  position: fixed; z-index: 999;
  padding: 4px 12px;
  font-family: var(--font); font-size: 11px; font-weight: 600;
  background: var(--warn); color: #000;
  border: none; border-radius: var(--radius);
  cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.4);
  animation: floatIn 0.15s ease;
  white-space: nowrap;
}
.copy-float:hover { background: #e09020; }
@keyframes floatIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
</style>
