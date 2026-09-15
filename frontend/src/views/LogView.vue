<script setup lang="ts">
// ── Apps 页(装配壳)─────────────────────────────────────
//   侧栏 = 平台分组卡片网格(LogPlatformCard,启停/右键菜单在卡片内);
//   主区 = 工具条(启停会话 chip + 右上工具组)+ 日志页签查看器(LogTabsPane)。

import { onMounted, computed } from 'vue'
import { useLogStore } from '@/stores/logs'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import type { LogEntry } from '@/types'
import Sidebar from '@/components/Sidebar.vue'
import TopRightTools from '@/components/TopRightTools.vue'
import LogPlatformCard from '@/components/LogPlatformCard.vue'
import LogTabsPane from '@/components/LogTabsPane.vue'

const store = useLogStore()
const projects = useProjectsStore()
const terminal = useTerminalStore()
const hasProject = computed(() => !!projects.currentProject)

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

/** 左上角 chip 导航:已自动最小化的启停一次性会话(短时反馈)。点 chip = 打开该服务日志页签(非恢复终端窗口) */
const oneshotChips = computed(() =>
  // 启停反馈 chip 只认「归属当前项目」的(视角开关不影响):点了开本项目的日志、关本项目的会话,
  // 绝不串别的项目的日志/终端
  terminal.projectEntries
    .filter(([, s]) => s.kind === 'cmd' && s.oneshot && s.minimized)
    .map(([port, s]) => {
      // label = "<服务名> · 启动/停止",从当前 logs 清单按 name 反查对应日志 file
      const svc = (s.label || '').split(' · ')[0]
      const log = store.filteredLogs.find(l => l.name === svc)
      return { port, label: s.label, file: log?.file ?? '' }
    }),
)

/** 点 chip:跳到该服务日志页(真实 .logs 滚动),并关掉一次性会话(它只是短时命令反馈) */
function openChipLog(c: { port: number; file: string; label: string }) {
  if (c.file) store.openFile(c.file, (c.label || '').split(' · ')[0] || '日志')
  terminal.closeSession(c.port)
}

onMounted(() => {
  store.refreshAll()
})
</script>

<template>
  <div class="app">
    <Sidebar>
      <!-- 文件列表 -->
      <div class="log-list-head">
        <span>应用服务</span>
        <span class="count" v-if="store.filteredLogs.length">{{ store.filteredLogs.length }}</span>
      </div>
      <div class="scroll-list">
        <div v-if="!hasProject" class="empty-hint">无项目,请点 ⚙ →「项目」添加/切换</div>
        <div v-else-if="!store.filteredLogs.length" class="empty-hint">该项目暂无日志,在 .code-panel/logs.yaml 添加</div>
        <div v-else class="platform-grid">
          <LogPlatformCard v-for="g in platformGroups" :key="g.name" :group="g" />
        </div>
      </div>
    </Sidebar>

    <!-- Main -->
    <main class="main">
      <!-- Toolbar:左上 = 启停会话 chip 导航(自动最小化的一次性终端);右上 = 工具组 -->
      <div class="toolbar">
        <div v-if="oneshotChips.length" class="os-chip-bar">
          <button
            v-for="c in oneshotChips"
            :key="c.port"
            class="os-chip"
            :title="`点击查看日志(${c.label})`"
            @click="openChipLog(c)"
          >▸ {{ c.label }}</button>
        </div>
        <TopRightTools class="trtr" />
      </div>

      <!-- 页签 + 日志内容(查看器子组件) -->
      <LogTabsPane />
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

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

/* 平台分组网格:一行一个大框(卡片本身见 LogPlatformCard) */
.platform-grid {
  display: grid;
  grid-template-columns: 100%;
  gap: 10px;
  padding: 6px 10px 10px;
  align-content: start;
  width: 100%;
  min-width: 0;
}

.toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar .trtr { margin-left: auto; }

/* 左上角启停会话 chip 导航(自动最小化的一次性终端;点 chip 放大看日志) */
.os-chip-bar {
  display: flex; align-items: center; gap: 6px;
  overflow-x: auto; overflow-y: hidden;
  max-width: 60%;
  scrollbar-width: none;
  flex: 0 1 auto;
}
.os-chip-bar::-webkit-scrollbar { display: none; }
.os-chip {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 200px;
  padding: 3px 10px;
  font-size: 11px; font-weight: 600;
  color: var(--glow);
  background: rgba(var(--glow-rgb),0.07);
  border: 1px solid var(--glow-dim);
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  transition: all 0.15s;
  animation: os-chip-breathe 1.6s ease-in-out infinite;
}
.os-chip:hover {
  background: rgba(var(--glow-rgb),0.16);
  border-color: var(--glow);
  animation: none;
  transform: scale(1.03);
}
@keyframes os-chip-breathe {
  0%, 100% { box-shadow: 0 0 0 rgba(var(--glow-rgb),0); }
  50%      { box-shadow: 0 0 6px rgba(var(--glow-rgb),0.35); }
}
</style>
