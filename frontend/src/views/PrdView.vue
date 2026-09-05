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
        <span v-if="files.length" class="status live">● {{ files.length }} 篇 MD</span>
        <button
          v-if="currentDir"
          class="done-btn"
          :class="{ on: !currentDirDone }"
          @click="toggleDone"
        >{{ currentDirDone ? '未完成' : '✓ 已完成' }}</button>
        <button @click="loadFolders">↻ Refresh</button>
        <span class="status">📄 PRD</span>
      </div>

      <div class="content-area">
        <div v-if="!hasProject" class="empty-state">
          <span class="icon">◈</span>
          <span>还没有项目,请先在侧栏「项目」添加一个项目</span>
        </div>
        <div v-else-if="!currentDir" class="empty-state">
          <span class="icon">◈</span>
          <span>Select a PRD folder from the sidebar</span>
        </div>
        <div v-else class="prd-file-list">
          <template v-for="f in files" :key="f.path">
            <div
              class="prd-file"
              :class="{ on: currentFile === f.name }"
              @click="openPreview(f.name)"
            >
              <span class="pf-name">{{ f.name }}</span>
              <button class="pf-view" @click.stop="openDoc(f.name)">查看 ›</button>
            </div>
            <!-- 预览：紧贴点中的文件下方 -->
            <div v-if="currentFile === f.name" class="pv-area">
              <div class="pv-head">
                <span>{{ f.name }}</span>
                <button class="pf-view" @click.stop="openDoc(f.name)">全屏 ›</button>
              </div>
              <iframe :src="previewUrl" class="pv-frame"></iframe>
            </div>
          </template>
          <div v-if="!files.length" class="empty-state">
            <span class="icon">◌</span>
            <span>该文件夹无 .md 文档</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import Sidebar from '@/components/Sidebar.vue'

interface PrdFolder { name: string; dir: string; fileCount: number; date: string; done: boolean }
interface PrdFile { name: string; path: string }

const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)

const folders = ref<PrdFolder[]>([])
const files = ref<PrdFile[]>([])
const currentDir = ref('')
const currentFile = ref('')

const currentDirDone = computed(() => folders.value.find(f => f.dir === currentDir.value)?.done || false)
const currentFolderName = computed(() => folders.value.find(f => f.dir === currentDir.value)?.name || '')

const previewUrl = computed(() =>
  currentDir.value && currentFile.value
    ? '/api/prd/content?dir=' + encodeURIComponent(currentDir.value) + '&file=' + encodeURIComponent(currentFile.value) + projectQSuffix()
    : ''
)

/** 当前项目 query 后缀(&project=<id>);无项目返回 '' */
function projectQSuffix(): string {
  return projects.currentId ? `&project=${encodeURIComponent(projects.currentId)}` : ''
}

async function loadFolders() {
  if (!projects.currentId) { folders.value = []; return }
  try {
    const res = await apiFetch(`/api/prd/folders?project=${encodeURIComponent(projects.currentId)}`)
    const data = await res.json()
    if (data.ok) {
      folders.value = data.folders || []
      // 保持已选中目录;否则默认选第一个
      if (currentDir.value && folders.value.some(f => f.dir === currentDir.value)) return
      const first = folders.value[0]
      if (first) await selectFolder(first.dir)
      else { currentDir.value = ''; currentFile.value = '' }
    }
  } catch { folders.value = [] }
}

async function selectFolder(dir: string) {
  currentDir.value = dir
  currentFile.value = ''
  try {
    const res = await apiFetch('/api/prd/files?dir=' + encodeURIComponent(dir))
    const data = await res.json()
    files.value = data.ok ? data.files : []
  } catch { files.value = [] }
}

function openPreview(fileName: string) {
  // 再点同一个 → 收起;点其他 → 展开该文件
  currentFile.value = currentFile.value === fileName ? '' : fileName
}

function openDoc(fileName: string) {
  const url = '/api/prd/view?dir=' + encodeURIComponent(currentDir.value) + '&file=' + encodeURIComponent(fileName) + projectQSuffix()
  window.open(url, '_blank')
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
  currentFile.value = ''
  files.value = []
  await loadFolders()
})

onMounted(loadFolders)
</script>

<style scoped>
/* ── 精确对齐 code-panel / LogView 布局 ── */
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.scroll-list { flex: 1; overflow-y: auto; padding: 8px; min-height: 25vh; }
.group-select {
  width: calc(100% - 16px); margin: 8px 8px 0;
  padding: 8px 12px;
  font-family: var(--font); font-size: 12px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  outline: none; cursor: pointer;
}
.group-select:focus { border-color: var(--glow-dim); }
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
.toolbar .status { font-size: 11px; color: var(--text-dim); }
.toolbar .status.live { color: var(--glow); }
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

.content-area { flex: 1; overflow-y: auto; padding: 12px 16px; position: relative; }
.prd-file-list { display: flex; flex-direction: column; gap: 6px; }
.prd-file {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 9px 12px; cursor: pointer;
  font-family: var(--font); transition: border-color 0.15s;
}
.prd-file:hover { border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.prd-file.on { border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }
.prd-file.on .pf-name { color: var(--glow); }
.pf-done { color: var(--text-dim); font-size: 12px; flex-shrink: 0; }
.pf-done.ok { color: var(--glow); font-weight: 700; }
.pf-name { flex: 1; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-view {
  background: transparent; color: var(--glow); border: 1px solid var(--glow-dim);
  border-radius: var(--radius); padding: 5px 12px;
  font-size: 10px; font-family: var(--font); cursor: pointer; font-weight: 600; letter-spacing: 0.04em;
}
.pf-view:hover { color: #000; background: var(--glow); }
/* 预览区：紧贴点中的文件下方 */
.pv-area { margin: 4px 0 8px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.pv-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 12px; background: var(--surface); border-bottom: 1px solid var(--border);
  font-family: var(--font); font-size: 11px; color: var(--text-dim);
}
.pv-frame { width: 100%; height: 360px; border: none; display: block; background: #0d0d10; }

:deep(.empty-state) { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 60px 0; color: var(--text-dim); }
:deep(.empty-state .icon) { font-size: 32px; }
:deep(.empty-state .hint) { font-size: 11px; color: var(--text-dim); }
</style>
