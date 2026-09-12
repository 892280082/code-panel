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
        <span v-if="currentDir && currentFileRel" class="status live mono" :title="currentFileRel">{{ currentFileRel }}</span>
        <button
          v-if="currentDir && currentFileRel"
          class="copy-btn"
          title="复制当前文件相对路径"
          @click="copyPath"
        >{{ copied ? '✓ 已复制' : '⧉ 复制路径' }}</button>
        <span class="toolbar-right">
          <button
            v-if="viewUrl"
            class="open-btn"
            title="在新窗口打开双栏页"
            @click="openInTab"
          >新窗口 ↗</button>
          <button :disabled="refreshing" title="重绘各中心看板并刷新视图" @click="reload">{{ refreshing ? '↻ 重绘中…' : '↻ Refresh' }}</button>
          <span v-if="refreshNote" class="refresh-note">{{ refreshNote }}</span>
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
          <template v-if="!folders.length">
            <span>还没有需求中心 —— 新项目先初始化 design-prd skill(统一原型调用方法),再按人名建中心</span>
            <button class="init-btn" :disabled="initializing" @click="initSkill">
              {{ initializing ? '⏳ 初始化中…' : '⚡ 初始化 design-prd skill' }}
            </button>
            <span class="hint">需求写 <code>.code-panel/prd/&lt;人名&gt;/</code>,看板由 ↻ Refresh 程序渲染</span>
            <span v-if="initMsg" class="init-msg">{{ initMsg }}</span>
          </template>
          <span v-else>从左侧选择 PRD 文件夹</span>
        </div>
        <div v-else-if="!entryFile" class="empty-state">
          <span class="icon">◌</span>
          <span>该文件夹无 .md 文档(index.md 或任意 md 均可作为入口)</span>
        </div>
        <iframe
          v-else
          :key="frameKey"
          ref="frameEl"
          :src="viewUrl"
          class="pv-full"
          @load="onFrameLoad"
        ></iframe>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { apiFetch, apiJson } from '@/utils/api-fetch'
import { injectHotkeyBridge } from '@/utils/iframe-hotkey-bridge'
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import Sidebar from '@/components/Sidebar.vue'
import TopRightTools from '@/components/TopRightTools.vue'
import { useCopyFeedback } from '@/composables/useCopyFeedback'

interface PrdFolder { name: string; dir: string; fileCount: number; date: string; done: boolean }
interface PrdFile { name: string; path: string }

const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)

const folders = ref<PrdFolder[]>([])
const currentDir = ref('')
const entryFile = ref('')        // 选中 folder 的默认打开文件(index.md 优先,否则第一篇)
const currentFile = ref('')      // iframe 当前实际显示文件(点左栏文件导航后更新)
const { copied, copy } = useCopyFeedback(2500)   // 复制路径按钮反馈
const frameKey = ref(0)          // 强制 iframe 重新加载
const frameEl = ref<HTMLIFrameElement | null>(null)

const currentFolderName = computed(() => folders.value.find(f => f.dir === currentDir.value)?.name || '')
/** 当前文件相对项目根路径(如 prd/原型规范/CONSTITUTION.md),供复制定位 */
const currentFileRel = computed(() => {
  if (!currentDir.value || !currentFile.value) return ''
  const root = projects.currentProject?.root
  let dir = currentDir.value
  if (root && dir.startsWith(root)) dir = dir.slice(root.length).replace(/^[/\\]+/, '')
  return `${dir}/${currentFile.value}`.replace(/\/+/g, '/')
})

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
    currentFile.value = entryFile.value
  } catch { entryFile.value = ''; currentFile.value = '' }
}

/** 初始化 design-prd skill(新项目统一原型调用方法;幂等,已存在文件不覆盖) */
const initializing = ref(false)
const initMsg = ref('')
async function initSkill() {
  if (!projects.currentId || initializing.value) return
  initializing.value = true
  initMsg.value = ''
  try {
    const data = await apiJson<{ skillDir: string; created: string[]; skipped: string[]; specsLinks: number }>('/api/prd/init-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: projects.currentId }),
    })
    initMsg.value = `✓ skill 已就绪(新建 ${data.created.length} · 保留 ${data.skipped.length})`
  } catch (e) {
    initMsg.value = `✗ ${(e as Error).message}`
  } finally {
    initializing.value = false
    setTimeout(() => { initMsg.value = '' }, 4000)
  }
}

/** ↻ Refresh = 先重绘看板(内置生成器,等价 AI 侧 `cp post /api/prd/gen-board`)再刷新视图;
 *  无项目/接口失败时退化为纯视图刷新,不阻塞浏览。 */
const refreshing = ref(false)
const refreshNote = ref('')
async function reload() {
  if (projects.currentId && !refreshing.value) {
    refreshing.value = true
    try {
      const res = await apiFetch('/api/prd/gen-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projects.currentId }),
      })
      const data = await res.json()
      refreshNote.value = data.ok ? '✓ 看板已重绘' : ''
      if (!data.ok) console.warn('[prd] 看板重绘失败:', data.error)
    } catch { /* 面板未连上等:仍刷新视图 */ } finally {
      refreshing.value = false
      if (refreshNote.value) setTimeout(() => { refreshNote.value = '' }, 2500)
    }
  }
  frameKey.value++
  loadFolders()
}

/** iframe 每次加载(选 folder 或 iframe 内点文件导航)后,从 iframe 当前真实地址解析文件 → 更新顶栏路径。
 *  ⚠️ 读 contentWindow.location 而非 .src:iframe 内部整页导航不改 DOM src 属性,只改 window.location。 */
function onFrameLoad() {
  const el = frameEl.value
  injectHotkeyBridge(el) // 快捷键桥:iframe 内 Ctrl+1 等组合上报父页面(见 utils/iframe-hotkey-bridge)
  const win = el?.contentWindow
  let href = ''
  try { href = win ? win.location.href : (el?.src || '') } catch { /* 跨域忽略 */ }
  if (!href) return
  try {
    const u = new URL(href, location.href)
    const f = u.searchParams.get('file')
    if (f) currentFile.value = decodeURIComponent(f)
  } catch { /* 忽略解析失败 */ }
}

function openInTab() {
  if (!viewUrl.value) return
  window.open(viewUrl.value, '_blank')
}

/** 复制当前文件相对路径到剪贴板(utils 带 http 内网兜底;成功后 copied 亮 2.5s 自动灭) */
async function copyPath() {
  const p = currentFileRel.value
  if (!p) return
  await copy(p)
}

// 项目切换:清空重载
watch(() => projects.currentId, async () => {
  currentDir.value = ''
  entryFile.value = ''
  currentFile.value = ''
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
/* 当前文件相对路径:monospace 小字,过长视觉截断但 DOM 文本完整可复制 */
.toolbar .status.live.mono {
  font-family: var(--font, monospace);
  font-size: 10px;
  max-width: 55%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  user-select: text; cursor: text;
}
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
.toolbar .copy-btn { color: var(--glow); border-color: var(--glow-dim); font-weight: 600; }
.toolbar .copy-btn:hover { background: rgba(34,238,102,0.1); color: var(--glow); }
.toolbar .open-btn { color: var(--glow); border-color: var(--glow-dim); font-weight: 600; }
.toolbar .refresh-note { font-size: 10px; color: var(--glow); }

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
:deep(.empty-state .hint code) { font-family: var(--font, monospace); font-size: 10px; color: var(--text-dim); }
.init-btn {
  font-family: var(--font); font-size: 11px; padding: 7px 16px;
  color: var(--glow); background: rgba(34,238,102,0.08);
  border: 1px solid var(--glow-dim); border-radius: var(--radius);
  cursor: pointer; font-weight: 600; transition: all 0.15s;
}
.init-btn:hover { background: rgba(34,238,102,0.15); }
.init-btn:disabled { opacity: 0.5; cursor: wait; }
.init-msg { font-size: 10px; color: var(--glow); }
</style>
