<script setup lang="ts">
import { onMounted, watch, ref, computed, nextTick } from 'vue'
import { useLogStore } from '@/stores/logs'
import { useProjectsStore } from '@/stores/projects'
import { ansiToHtml, ansiStrip } from '@/composables/useAnsi'
import type { LogEntry } from '@/types'
import Sidebar from '@/components/Sidebar.vue'
import StatusDot from '@/components/StatusDot.vue'
import QuickLaunchDrawer from '@/components/QuickLaunchDrawer.vue'
import BackupDrawer from '@/components/BackupDrawer.vue'

const store = useLogStore()
const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)
const ansiLabels: Record<string, string> = { strip: '🎨 strip', raw: '🔤 raw', color: '🌈 color' }
const logEl = ref<HTMLElement | null>(null)

// 按平台分组(platform 缺失时回退「未分组」);每组渲染为一张大卡片
const platformGroups = computed(() => {
  const m = new Map<string, LogEntry[]>()
  for (const l of store.filteredLogs) {
    const k = l.platform || '未分组'
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(l)
  }
  return [...m.entries()].map(([name, logs]) => ({ name, logs }))
})

/** 卡片左列:后端(或旧 sections 无 side 的全放左列) */
function colA(g: { logs: LogEntry[] }) {
  return g.logs.filter(l => l.side !== '前端')
}
/** 卡片右列:前端 */
function colB(g: { logs: LogEntry[] }) {
  return g.logs.filter(l => l.side === '前端')
}

onMounted(() => {
  store.refreshAll()
  // Periodic update of activity indicators
  setInterval(() => { /* triggers reactivity for activity dots */ }, 500)
})

function renderContent(text: string): string {
  if (store.ansiMode === 'strip') return ansiStrip(text)
  if (store.ansiMode === 'color') return ansiToHtml(text)
  return text
}

function getLogStatus(log: LogEntry) {
  // SSE 实时端口状态优先（比 /api/logs 的初始 alive 字段更新）
  if (log.port && store.portStatusMap[log.port] !== undefined) {
    return store.portStatusMap[log.port] ? 'alive' : 'dead'
  }
  if (log.alive) return 'alive'
  if (log.port) return 'dead'
  if (!log.exists) return 'missing'
  return undefined
}

/** 端口号数字亮/暗：与圆点同源（SSE 实时 portStatusMap），避免定时检测只亮圆点不亮数字 */
function getPortAlive(log: LogEntry): boolean {
  if (log.port && store.portStatusMap[log.port] !== undefined) {
    return store.portStatusMap[log.port]
  }
  return !!log.alive
}

const activityNow = ref(Date.now())
function isActive(fp: string): boolean {
  // trigger reactivity
  void activityNow.value
  const t = store.activityMap[fp]
  return !!t && (Date.now() - t < 3000)
}
// Refresh activity indicator
setInterval(() => { activityNow.value = Date.now() }, 500)

const currentContent = computed(() => {
  if (!store.activeFile || !store.tabs[store.activeFile]) return ''
  return renderContent(store.tabs[store.activeFile].content)
})

const currentLines = computed(() => {
  if (!store.activeFile || !store.tabs[store.activeFile]) return 0
  return store.tabs[store.activeFile].lines
})

const isAutoScroll = computed(() => {
  if (!store.activeFile) return true
  return store.autoScroll[store.activeFile] !== false
})

// Auto-scroll to bottom when content changes
watch(currentContent, () => {
  if (store.activeFile && isAutoScroll.value) {
    nextTick(() => {
      if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
    })
  }
})
</script>

<template>
  <div class="app">
    <Sidebar>
      <!-- 文件列表 -->
      <div class="log-list-head">
        <span>日志文件</span>
        <span class="count" v-if="store.filteredLogs.length">{{ store.filteredLogs.length }}</span>
      </div>
      <div class="scroll-list">
        <div v-if="!hasProject" class="empty-hint">无项目,请点 ⚙ →「项目」添加/切换</div>
        <div v-else-if="!store.filteredLogs.length" class="empty-hint">该项目暂无日志,在 .code-panel/logs.yaml 添加</div>
        <div v-else class="platform-grid">
          <section v-for="g in platformGroups" :key="g.name" class="platform-card">
            <h3 class="platform-name">{{ g.name }}<span v-if="g.logs.length" class="cnt">{{ g.logs.length }}</span></h3>
            <div class="pc-cols">
              <!-- 左列:后端(或旧格式全部);右列:前端,二者并排;每项名字在上、端口在下 -->
              <div v-if="colA(g).length" class="pc-col" :class="{ wide: !colB(g).length }">
                <div
                  v-for="log in colA(g)" :key="log.file"
                  class="list-item file-item"
                  :class="{ selected: store.activeFile === log.file }"
                  @click="store.openFile(log.file, log.name)"
                >
                  <div class="tile-top">
                    <StatusDot :status="getLogStatus(log)" />
                    <span class="name">{{ log.name }}</span>
                    <span v-if="store.newContentMap[log.file]" class="blink txt-blink">T</span>
                  </div>
                  <div v-if="log.port" class="tile-sub">
                    <span class="port-tag" :class="{ alive: getPortAlive(log) }">{{ log.port }}</span>
                  </div>
                </div>
              </div>
              <div v-if="colB(g).length" class="pc-col" :class="{ wide: !colA(g).length }">
                <div
                  v-for="log in colB(g)" :key="log.file"
                  class="list-item file-item"
                  :class="{ selected: store.activeFile === log.file }"
                  @click="store.openFile(log.file, log.name)"
                >
                  <div class="tile-top">
                    <StatusDot :status="getLogStatus(log)" />
                    <span class="name">{{ log.name }}</span>
                    <span v-if="store.newContentMap[log.file]" class="blink txt-blink">T</span>
                  </div>
                  <div v-if="log.port" class="tile-sub">
                    <span class="port-tag" :class="{ alive: getPortAlive(log) }">{{ log.port }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Sidebar>

    <!-- Main -->
    <main class="main">
      <!-- Toolbar -->
      <div class="toolbar">
        <button @click="store.refreshAll()">↻ Refresh</button>
        <button
          :class="{ on: store.ansiMode === 'strip', danger: store.ansiMode === 'color' }"
          @click="store.cycleAnsi()"
        >{{ ansiLabels[store.ansiMode] }}</button>
        <span class="status">{{ store.connected ? '● connected' : '○ reconnecting' }}</span>
        <QuickLaunchDrawer />
        <BackupDrawer />
      </div>

      <!-- Tab Bar -->
      <div v-if="store.hasTabs" class="tab-bar">
        <div
          v-for="(tab, fp) in store.tabs" :key="fp"
          class="tab"
          :class="{ current: store.activeFile === fp }"
          @click="store.activeFile = fp"
        >
          <span class="tab-dot" :class="{ 'tab-active': isActive(fp) }"></span>
          <span>{{ tab.name }}</span>
          <span class="tab-close" @click.stop="store.closeTab(fp)">✕</span>
        </div>
      </div>

      <!-- Content -->
      <div class="content-area">
        <!-- Empty state:无项目 -->
        <div v-if="!hasProject" class="empty-state">
          <span class="icon">◈</span>
          <span>还没有项目</span>
          <span class="hint">点左上角 ⚙ →「项目」添加/切换一个项目</span>
        </div>

        <!-- Empty state:有项目但未打开文件 -->
        <div v-else-if="!store.activeFile" class="empty-state">
          <span class="icon">◈</span>
          <span>Select a log file from the sidebar</span>
          <span class="hint">● 端口存活 &nbsp; 3003 端口号 &nbsp; <b class="txt-blink-hint">T</b> 新日志写入</span>
        </div>

        <!-- Log Panel -->
        <div v-else class="log-panel">
          <div
            class="log-content"
            :key="store.activeFile + ':' + store.ansiMode"
            :innerHTML="store.ansiMode === 'color' ? currentContent : undefined"
            ref="logEl"
          >
            <template v-if="store.ansiMode !== 'color'">{{ currentContent }}</template>
          </div>
          <div class="log-controls">
            <button
              :class="{ on: isAutoScroll }"
              @click="store.autoScroll[store.activeFile!] = !store.autoScroll[store.activeFile!]"
            >{{ isAutoScroll ? '● Auto-scroll' : '○ Auto-scroll' }}</button>
            <button @click="store.clearLog(store.activeFile!)">Clear</button>
            <span class="line-count">{{ currentLines.toLocaleString() }} lines</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.group-select, select {
  width: 100%; padding: 8px 12px;
  font-family: var(--font); font-size: 12px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  outline: none; cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6b78' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.log-list-head {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px 4px; font-size: 10px; color: var(--text-dim);
  letter-spacing: 0.06em;
}
.log-list-head .count {
  font-size: 9px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 0 6px; line-height: 16px;
}
.empty-hint { font-size: 11px; color: var(--text-dim); text-align: center; padding: 20px 8px; line-height: 1.8; }

.scroll-list { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px; min-height: 25vh; }
.scroll-list::-webkit-scrollbar { width: 4px; }
.scroll-list::-webkit-scrollbar-track { background: transparent; }
.scroll-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.list-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin: 2px 0;
  border-radius: var(--radius); cursor: pointer;
  font-size: 12px; border: 1px solid transparent;
}
.list-item:hover { background: #1a1a22; border-color: var(--border); }
.list-item.selected { background: #1a1a28; border-color: var(--glow-dim); }

.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-tag {
  flex-shrink: 0; font-size: 9px; color: var(--text-dim);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 3px; padding: 0 5px; max-width: 90px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar .status { margin-left: auto; font-size: 11px; color: var(--text-dim); }
.toolbar button {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
}
.toolbar button:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.toolbar button.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }
.toolbar button.danger:hover { color: var(--danger); border-color: var(--danger); }

.tab-bar {
  display: flex; align-items: flex-end;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 4px; min-height: 40px;
  overflow-x: auto;
}
.tab-bar::-webkit-scrollbar { height: 0; }
.tab {
  display: flex; align-items: center; gap: 7px;
  padding: 10px 16px; font-size: 12px; cursor: pointer;
  border-radius: var(--radius) var(--radius) 0 0;
  white-space: nowrap; transition: background 0.15s;
  border: 1px solid transparent; border-bottom: none;
  color: var(--text-dim); margin-right: 2px;
}
.tab:hover { background: #1a1a24; color: var(--text); }
.tab.current { background: var(--bg); border-color: var(--border); color: var(--text); }
.tab .tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: transparent; }
.tab .tab-dot.tab-active { background: var(--glow); box-shadow: 0 0 4px var(--glow); }
.tab .tab-close {
  font-size: 14px; color: var(--text-dim);
  line-height: 1; padding: 0 3px; border-radius: 2px; cursor: pointer;
}
.tab .tab-close:hover { color: var(--danger); background: rgba(244,71,71,0.15); }

.content-area { flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.empty-state {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--text-dim); font-size: 12px; gap: 8px; user-select: none;
}
.empty-state .icon { font-size: 48px; opacity: 0.3; margin-bottom: 8px; }
.empty-state .hint { font-size: 10px; color: var(--text-dim); }
.empty-state .hint .txt-blink-hint {
  font-weight: 800; color: var(--glow);
  animation: blink 0.5s ease-in-out infinite alternate;
}

.log-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.log-content {
  flex: 1; overflow-y: auto;
  padding: 16px 20px;
  font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-all;
  font-variant-ligatures: none;
}
.log-content::-webkit-scrollbar { width: 4px; }
.log-content::-webkit-scrollbar-track { background: transparent; }
.log-content::-webkit-scrollbar-thumb { background: #1a1a22; border-radius: 2px; }

.log-controls {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  font-size: 11px;
}
.log-controls button {
  font-family: var(--font); font-size: 10px;
  padding: 4px 10px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
}
.log-controls button:hover { color: var(--text); border-color: var(--glow-dim); }
.log-controls button.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }
.line-count { margin-left: auto; color: var(--text-dim); font-variant-numeric: tabular-nums; }

.port-tag {
  font-size: 10px; font-weight: 600;
  padding: 1px 5px; border-radius: 3px;
  background: var(--surface); color: var(--text-dim);
  border: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.port-tag.alive {
  color: var(--glow);
  border-color: var(--glow-dim);
  background: rgba(34,238,102,0.08);
}

.txt-blink {
  font-size: 10px; font-weight: 800;
  color: var(--glow);
  margin-left: 2px;
  animation: blink 0.5s ease-in-out infinite alternate;
}
@keyframes blink {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0.2; transform: scale(1.3); }
}

.blink {
  display: inline-block; font-size: 9px; color: var(--warn);
  animation: pulse 0.6s ease-in-out infinite alternate;
}
@keyframes pulse {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0.3; transform: scale(1.4); }
}
/* 平台分组:一行一个大框,每卡左上角「缺一口」放平台名;卡内 后端|前端 并排 */
.platform-grid {
  display: grid;
  grid-template-columns: 100%;
  gap: 10px;
  padding: 6px 10px 10px;
  align-content: start;
  width: 100%;
  min-width: 0;
}
.platform-card {
  position: relative;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  padding: 16px 10px 6px;
}
.platform-name {
  position: absolute; top: -11px; left: 14px; margin: 0; z-index: 2;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 2px 12px;
  white-space: nowrap;
  cursor: default;
}
.platform-name .cnt {
  font-size: 9px; color: var(--text-dim);
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 0 5px; line-height: 14px;
}
.pc-cols { display: flex; gap: 8px; align-items: stretch; width: 100%; min-width: 0; }
.pc-col { flex: 1 1 0; min-width: 0; overflow: hidden; }
.pc-col.wide { flex: 1 1 100%; }
.platform-card .list-item {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
  padding: 5px 10px; margin: 2px 0;
  border: 1px solid transparent;
  border-radius: 8px;
}
.platform-card .list-item .tile-top {
  display: flex; align-items: center; gap: 6px; min-width: 0;
}
.platform-card .list-item .name { min-width: 0; font-size: 12px; }
.platform-card .list-item .tile-sub {
  display: flex; align-items: center;
  padding-left: 12px; /* 与名字行圆点错位对齐 */
}
.platform-card .list-item.selected {
  background: #1a1a28; border-color: var(--glow-dim);
}

</style>
