<script setup lang="ts">
// ── 平台卡片(Apps 页侧栏;从 LogView 抽出)──────────────────
//   一张卡 = 一个平台分组:卡内 后端|前端 两列服务项并排。
//   交互:点行开日志页签;右侧圆点启停(有脚本可点,无脚本纯状态);
//   右键弹启动/停止菜单(Teleport,每卡独立状态,同一时刻至多一张卡弹出)。
//   数据经 Pinia 单例(store)直读,与拆分前同源。

import { ref, computed } from 'vue'
import { useLogStore } from '@/stores/logs'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import type { LogEntry } from '@/types'
import StatusDot from '@/components/StatusDot.vue'

const props = defineProps<{ group: { name: string; logs: LogEntry[] } }>()

const store = useLogStore()
const projects = useProjectsStore()
const terminal = useTerminalStore()

/** 卡片左列:后端(或旧 sections 无 side 的全放左列) */
function colA(g: { logs: LogEntry[] }) {
  return g.logs.filter(l => l.side !== '前端')
}
/** 卡片右列:前端 */
function colB(g: { logs: LogEntry[] }) {
  return g.logs.filter(l => l.side === '前端')
}

/** 启动/停止:一次性执行(命令跑完窗口自动关闭回收,不留残留常驻窗口) */
async function runService(log: LogEntry) {
  if (!projects.currentProject) return
  const alive = log.port !== undefined && log.port !== null && getPortAlive(log)
  const cmd = alive ? log.stop : log.start
  if (!cmd) return
  try {
    await terminal.createSession(`${log.name} · ${alive ? '停止' : '启动'}`, cmd, projects.currentProject.root, false)
  } catch { /* 端口池满等错误忽略 */ }
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

// ── 右键菜单:启动/停止(随状态显示) ─────────────────────
const ctxMenu = ref<{ x: number; y: number; log: LogEntry } | null>(null)
function openCtx(e: MouseEvent, log: LogEntry) {
  if (!log.start && !log.stop) return // 无脚本不弹
  ctxMenu.value = { x: e.clientX, y: e.clientY, log }
}
function closeCtx() { ctxMenu.value = null }
const ctxLabel = computed(() => {
  const m = ctxMenu.value
  if (!m) return ''
  return m.log.port !== undefined && m.log.port !== null && getPortAlive(m.log) ? '停止' : '启动'
})
function ctxAction() {
  const m = ctxMenu.value
  if (!m) return
  const log = m.log
  closeCtx()
  runService(log)
}
</script>

<template>
  <section class="platform-card">
    <h3 class="platform-name">{{ props.group.name }}<span v-if="props.group.logs.length" class="cnt">{{ props.group.logs.length }}</span></h3>
    <div class="pc-cols">
      <!-- 左列:后端(或旧格式全部);右列:前端,二者并排;每项名字在上、端口在下 -->
      <div v-if="colA(group).length" class="pc-col" :class="{ wide: !colB(group).length }">
        <div
          v-for="log in colA(group)" :key="log.file"
          class="list-item file-item"
          :class="{ selected: store.activeFile === log.file }"
          @click="store.openFile(log.file, log.name)"
          @contextmenu.prevent="openCtx($event, log)"
        >
          <div class="tile-main">
            <div class="tile-top">
              <span class="name">{{ log.name }}</span>
            </div>
            <div v-if="log.port" class="tile-sub">
              <span class="port-tag" :class="{ alive: getPortAlive(log) }">{{ log.port }}</span>
              <span v-if="store.newContentMap[log.file]" class="blink txt-blink t-with-port" title="有新日志写入">T</span>
            </div>
          </div>
          <!-- 右侧启停圆点:有脚本 → 可点(悬停放大/呼吸);无脚本 → 纯状态点,点按落入整行开日志 -->
          <button
            v-if="log.start || log.stop"
            class="svc-btn"
            :title="getPortAlive(log) ? `⏹ 停止 ${log.name}` : `▶ 启动 ${log.name}`"
            @click.stop="runService(log)"
          ><StatusDot :status="getLogStatus(log)" /></button>
          <span v-else class="svc-btn noop"><StatusDot :status="getLogStatus(log)" /></span>
        </div>
      </div>
      <div v-if="colB(group).length" class="pc-col" :class="{ wide: !colA(group).length }">
        <div
          v-for="log in colB(group)" :key="log.file"
          class="list-item file-item"
          :class="{ selected: store.activeFile === log.file }"
          @click="store.openFile(log.file, log.name)"
          @contextmenu.prevent="openCtx($event, log)"
        >
          <div class="tile-main">
            <div class="tile-top">
              <span class="name">{{ log.name }}</span>
            </div>
            <div v-if="log.port" class="tile-sub">
              <span class="port-tag" :class="{ alive: getPortAlive(log) }">{{ log.port }}</span>
              <span v-if="store.newContentMap[log.file]" class="blink txt-blink t-with-port" title="有新日志写入">T</span>
            </div>
          </div>
          <!-- 右侧启停圆点:有脚本 → 可点(悬停放大/呼吸);无脚本 → 纯状态点,点按落入整行开日志 -->
          <button
            v-if="log.start || log.stop"
            class="svc-btn"
            :title="getPortAlive(log) ? `⏹ 停止 ${log.name}` : `▶ 启动 ${log.name}`"
            @click.stop="runService(log)"
          ><StatusDot :status="getLogStatus(log)" /></button>
          <span v-else class="svc-btn noop"><StatusDot :status="getLogStatus(log)" /></span>
        </div>
      </div>
    </div>
  </section>

  <!-- 右键菜单:启动/停止(Teleport,仍带本组件 scope) -->
  <Teleport to="body">
    <div v-if="ctxMenu" class="ctx-backdrop" @click="closeCtx" @contextmenu.prevent="closeCtx" />
    <div v-if="ctxMenu" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
      <button class="ctx-item" :class="{ stop: ctxLabel === '停止' }" @click="ctxAction">{{ ctxLabel }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 平台分组:一行一个大框,每卡左上角「缺一口」放平台名;卡内 后端|前端 并排 */
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

.list-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin: 2px 0;
  border-radius: var(--radius); cursor: pointer;
  font-size: 12px; border: 1px solid transparent;
}
.list-item:hover { background: #1a1a22; border-color: var(--border); }
.list-item.selected { background: #1a1a28; border-color: var(--glow-dim); }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.platform-card .list-item {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 5px 10px; margin: 2px 0;
  border: 1px solid transparent;
  border-radius: 8px;
}
.platform-card .list-item .tile-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
}
.platform-card .list-item .tile-top {
  display: flex; align-items: center; gap: 6px; min-width: 0;
}
.platform-card .list-item .name { min-width: 0; font-size: 12px; }
.platform-card .list-item .tile-sub {
  display: flex; align-items: center;
  padding-left: 2px; /* 名字直接顶格,端口对齐名字 */
  gap: 5px;
}
/* T 新日志写入标记:与端口号同排 */
.platform-card .list-item .t-with-port {
  margin: 0;
  font-size: 10px;
  line-height: 1;
}
.platform-card .list-item .svc-btn {
  flex: 0 0 auto;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; padding: 0;
  border-radius: 50%;
  cursor: pointer;
}
.platform-card .list-item .svc-btn.noop { cursor: default; }
/* 服务项圆点:默认 13px;有启停脚本时悬停放大 + 呼吸,提示可点击 */
.platform-card .list-item :deep(.dot) {
  width: 13px; height: 13px;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.platform-card .list-item .svc-btn:not(.noop):hover :deep(.dot),
.platform-card .list-item .svc-btn:not(.noop):active :deep(.dot) {
  animation: dot-breathe 0.8s ease-in-out infinite;
}
@keyframes dot-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.45); }
}
.platform-card .list-item.selected {
  background: #1a1a28; border-color: var(--glow-dim);
}

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
  background: rgba(var(--glow-rgb),0.08);
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

/* 右键菜单(Teleport,仍带本组件 scope) */
.ctx-backdrop { position: fixed; inset: 0; z-index: 9000; background: transparent; }
.ctx-menu {
  position: fixed; z-index: 9001; min-width: 120px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.ctx-item {
  display: block; width: 100%; text-align: left;
  padding: 8px 12px; background: transparent;
  color: var(--glow); border: none; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.ctx-item.stop { color: var(--danger); }
.ctx-item:hover { background: #1a1a28; }
</style>
