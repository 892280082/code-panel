<script setup lang="ts">
// ── 日志页签查看器(Apps 页主区;从 LogView 抽出)────────────
//   页签栏(活跃呼吸点/关闭)+ 空态(无项目/未选文件)+ 日志内容
//   (ANSI 三模式:strip/raw/color)+ 底部控制条(自动滚动/清空/连接状态/行数)。
//   数据经 Pinia 单例(store)直读,与拆分前同源。

import { computed, nextTick, ref, watch } from 'vue'
import { useLogStore } from '@/stores/logs'
import { useProjectsStore } from '@/stores/projects'
import { ansiToHtml, ansiStrip } from '@/composables/useAnsi'
import Starfield from '@/components/Starfield.vue'

const store = useLogStore()
const projects = useProjectsStore()
const hasProject = computed(() => !!projects.currentProject)

const ansiLabels: Record<string, string> = { strip: '🎨 strip', raw: '🔤 raw', color: '🌈 color' }
const logEl = ref<HTMLElement | null>(null)

function renderContent(text: string): string {
  if (store.ansiMode === 'strip') return ansiStrip(text)
  if (store.ansiMode === 'color') return ansiToHtml(text)
  return text
}

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

// 页签活跃呼吸点:500ms 心跳驱动重算(本组件与 LogView 同生命周期,节拍不变)
const activityNow = ref(Date.now())
function isActive(fp: string): boolean {
  // trigger reactivity
  void activityNow.value
  const t = store.activityMap[fp]
  return !!t && (Date.now() - t < 3000)
}
setInterval(() => { activityNow.value = Date.now() }, 500)
</script>

<template>
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
      <Starfield />
      <span>还没有项目</span>
      <span class="hint">点左上角 ⚙ →「项目」添加/切换一个项目</span>
    </div>

    <!-- Empty state:有项目但未打开文件 -->
    <div v-else-if="!store.activeFile" class="empty-state">
      <Starfield />
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
        <button
          class="ansi-btn"
          :class="{ on: store.ansiMode === 'strip', danger: store.ansiMode === 'color' }"
          @click="store.cycleAnsi()"
        >{{ ansiLabels[store.ansiMode] }}</button>
        <span class="status" :class="{ down: !store.connected }">{{ store.connected ? '● connected' : '○ reconnecting' }}</span>
        <span class="line-count">{{ currentLines.toLocaleString() }} lines</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.tab .tab-close:hover { color: var(--danger); background: rgba(var(--danger-rgb),0.15); }

.content-area { flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.empty-state {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--text-dim); font-size: 12px; gap: 8px; user-select: none;
}
.empty-state > span { position: relative; z-index: 1; }
.empty-state .icon { font-size: 48px; opacity: 0.3; margin-bottom: 8px; }
.empty-state .hint { font-size: 10px; color: var(--text-dim); }
.empty-state .hint .txt-blink-hint {
  font-weight: 800; color: var(--glow);
  animation: blink 0.5s ease-in-out infinite alternate;
}
@keyframes blink {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0.2; transform: scale(1.3); }
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
.log-controls button.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(var(--glow-rgb),0.06); }
.log-controls button.danger, .log-controls button.danger.on { color: var(--danger); border-color: var(--danger); background: rgba(var(--danger-rgb),0.06); }
.log-controls .ansi-btn { min-width: 74px; text-align: center; }
.log-controls .status { font-size: 11px; color: var(--text-dim); }
.log-controls .status.down { color: var(--danger); }
.line-count { margin-left: auto; color: var(--text-dim); font-variant-numeric: tabular-nums; }
</style>
