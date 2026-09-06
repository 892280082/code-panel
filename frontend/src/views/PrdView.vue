<template>
  <div class="app">
    <Sidebar>
      <div class="scroll-list">
        <div v-if="!hasProject" class="empty-hint">无项目,请在顶部「项目」添加</div>
        <div v-else-if="!folders.length" class="empty-hint">未配置 PRD 文件夹<br>可用 ⚙ 或手改 prd.yaml 添加</div>
        <div
          v-for="f in folders" :key="f.dir"
          class="list-item file-item"
          :class="{ selected: currentDir === f.dir }"
          @click="selectFolder(f.dir)"
        >
          <span class="pf-done" :class="{ ok: f.done }">{{ f.done ? '✓' : '○' }}</span>
          <div class="folder-block">
            <div class="fb-name">{{ f.name }}</div>
            <div class="fb-dir">{{ f.dir.split('/').slice(-2).join('/') }}</div>
            <div class="fb-date">📅 {{ f.date || '—' }}</div>
          </div>
          <span class="port-tag">{{ f.fileCount }}</span>
        </div>
      </div>
    </Sidebar>

    <main class="main">
      <div class="toolbar">
        <span class="status">{{ currentFolderName || 'PRD 文档' }}</span>
        <span v-if="currentDir && entryFile" class="status live">● {{ entryFile }}</span>
        <button
          v-if="currentDir"
          class="done-btn"
          :class="{ on: !currentDirDone }"
          @click="toggleDone"
        >{{ currentDirDone ? '未完成' : '✓ 已完成' }}</button>
        <span class="toolbar-right">
          <button
            v-if="viewUrl"
            class="open-btn"
            title="在新窗口打开双栏页"
            @click="openInTab"
          >新窗口 ↗</button>
          <button @click="reload">↻ Refresh</button>
          <TopRightTools />
        </span>
      </div>

      <!-- 整屏内容:左侧选中 folder → 右侧一块撑满 iframe = 后台 /api/prd/view 渲染的双栏页 -->
      <div class="content-area">
        <div v-if="!hasProject" class="empty-state">
          <span class="icon">◈</span>
          <span>还没有项目,请先在侧栏「项目」添加一个项目</span>
        </div>
        <div v-else-if="!currentDir" class="empty-state">
          <span class="icon">◈</span>
          <span>从左侧选择 PRD 文件夹</span>
        </div>
        <div v-else-if="!entryFile" class="empty-state">
          <span class="icon">◌</span>
          <span>该文件夹无 .md 文档(index.md 或任意 md 均可作为入口)</span>
        </div>
        <iframe
          v-else
          :key="frameKey"
          :src="viewUrl"
          class="pv-full"
          @load="onFrameLoad"
        ></iframe>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import Sidebar from '@/components/Sidebar.vue'
import TopRightTools from '@/components/TopRightTools.vue'

interface PrdFolder { name: string; dir: string; fileCount: number; date: string; done: boolean }
interface PrdFile { name: string; path: string }

const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)

const folders = ref<PrdFolder[]>([])
const currentDir = ref('')
const entryFile = ref('')        // 选中 folder 的默认打开文件(index.md 优先,否则第一篇)
const frameKey = ref(0)          // 强制 iframe 重新加载

const currentDirDone = computed(() => folders.value.find(f => f.dir === currentDir.value)?.done || false)
const currentFolderName = computed(() => folders.value.find(f => f.dir === currentDir.value)?.name || '')

/** 后台双栏渲染页(自带 MD 文件导航),整屏内嵌;?project= 让正文链接翻页时上下文连续 */
const viewUrl = computed(() =>
  currentDir.value && entryFile.value
    ? '/api/prd/view?dir=' + encodeURIComponent(currentDir.value) + '&file=' + encodeURIComponent(entryFile.value) + projectQSuffix()
    : ''
)

/** 当前项目 query 后缀(&project=<id>);无项目返回 '' */
function projectQSuffix(): string {
  return projects.currentId ? `&project=${encodeURIComponent(projects.currentId)}` : ''
}

async function loadFolders() {
  if (!projects.currentId) { folders.value = []; currentDir.value = ''; entryFile.value = ''; return }
  try {
    const res = await apiFetch(`/api/prd/folders?project=${encodeURIComponent(projects.currentId)}`)
    const data = await res.json()
    if (data.ok) {
      folders.value = data.folders || []
      // 保持已选中目录;否则默认选第一个
      if (currentDir.value && folders.value.some(f => f.dir === currentDir.value)) return
      const first = folders.value[0]
      if (first) await selectFolder(first.dir)
      else { currentDir.value = ''; entryFile.value = '' }
    }
  } catch { folders.value = [] }
}

/** 选中 folder:右侧整屏 iframe 打开该目录双栏页(入口 = index.md 优先,无则第一篇 md) */
async function selectFolder(dir: string) {
  currentDir.value = dir
  entryFile.value = ''
  frameKey.value++
  try {
    const res = await apiFetch('/api/prd/files?dir=' + encodeURIComponent(dir))
    const data = await res.json()
    const list: PrdFile[] = data.ok ? data.files : []
    const entry = list.find(f => f.name === 'index.md') || list[0]
    entryFile.value = entry ? entry.name : ''
  } catch { entryFile.value = '' }
}

function reload() {
  frameKey.value++
  loadFolders()
}

function onFrameLoad() {
  // iframe 就绪(内部点击链接由 iframe 自行导航,无需干预)
}

function openInTab() {
  if (!viewUrl.value) return
  window.open(viewUrl.value, '_blank')
}

async function toggleDone() {
  if (!projects.currentId) return
  const target = folders.value.find(f => f.dir === currentDir.value)
  if (!target) return
  const next = !target.done
  try {
    await apiFetch('/api/prd/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: projects.currentId, dir: currentDir.value, done: next }),
    })
    target.done = next
  } catch { /* ignore */ }
}

// 项目切换:清空重载
watch(() => projects.currentId, async () => {
  currentDir.value = ''
  entryFile.value = ''
  frameKey.value++
  await loadFolders()
})

onMounted(loadFolders)
</script>

<style scoped>
/* ── 精确对齐 code-panel / LogView 布局 ── */
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.scroll-list { flex: 1; overflow-y: auto; padding: 8px; min-height: 25vh; }
.empty-hint { font-size: 11px; color: var(--text-dim); text-align: center; padding: 20px 8px; line-height: 1.8; }
.list-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 4px; }
.folder-block { flex: 1; min-width: 0; }
.fb-name { font-size: 12px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-dir { font-size: 10px; color: var(--text-dim); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-date { font-size: 10px; color: var(--text-dim); margin-top: 2px; }
.list-item.selected .fb-name { color: var(--glow); }
.port-tag { font-size: 10px; color: var(--text-dim); border: 1px solid var(--border); padding: 0 5px; border-radius: var(--radius); flex-shrink: 0; }

.toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar button { height: 26px; padding-top: 0; padding-bottom: 0; box-sizing: border-box; }
.toolbar .status { font-size: 11px; color: var(--text-dim); }
.toolbar .status.live { color: var(--glow); }
.toolbar .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.toolbar .spacer { flex: 1; }
.toolbar button {
  font-family: var(--font); font-size: 10px;
  padding: 6px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
}
.toolbar button:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.toolbar .done-btn.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); font-weight: 700; }
.toolbar .open-btn { color: var(--glow); border-color: var(--glow-dim); font-weight: 600; }

/* 整屏 iframe:右侧主区一块撑满 */
.content-area {
  flex: 1; min-height: 0;
  padding: 0;
  background: #f2f3f5;
  display: flex; flex-direction: column;
}
.pv-full {
  flex: 1; width: 100%;
  border: none; display: block;
}

:deep(.empty-state) { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 100%; color: var(--text-dim); }
:deep(.empty-state .icon) { font-size: 32px; }
:deep(.empty-state .hint) { font-size: 11px; color: var(--text-dim); }
</style>
