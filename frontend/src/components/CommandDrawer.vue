<script setup lang="ts">
// ── 命令抽屉(右下角 FAB + 芯片簇 + 抽屉骨架)───────────────────
//   职责拆分:FAB 几何/拖拽/芯片联动在 composables/useFabChips.ts;
//   「会话」Tab 在 TmuxSessionsTab.vue;历史命令编辑弹窗在
//   CommandEditModal.vue(0e4bade 起命令改 commands.yaml 纯展示,未挂载)。

import { apiFetch } from '@/utils/api-fetch'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useCloudStore } from '@/stores/cloud'
import { useFabChips } from '@/composables/useFabChips'
import TmuxSessionsTab from '@/components/TmuxSessionsTab.vue'

const terminal = useTerminalStore()
const projects = useProjectsStore()
const browser = useRepoBrowserStore()
const cloud = useCloudStore()
const commands = ref<any[]>([])
const activeTab = ref<'custom' | 'system' | 'tmux'>('custom')
const showNewTmux = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const systemCmds = computed(() => commands.value.filter((c: any) => c.type === 'system'))
const customCmds = computed(() => commands.value.filter((c: any) => c.type === 'custom'))

// ── 子分组聚合：按 subgroup 分块展示（未设置 subgroup 的命令归入默认块）──
const groupedCustomCmds = computed(() => {
  const map = new Map<string, any[]>()
  for (const c of customCmds.value) {
    const g = c.subgroup || ''
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(c)
  }
  return Array.from(map.entries())
})

// ── FAB + 芯片簇(位置持久化/拖拽/点击联动;markup 与样式在本文件)──
const {
  btnX, btnY, sessionList,
  chipsBarRight, repoChipRight, cloudChipRight,
  onTriggerDragStart, onTriggerClick,
  onChipClick, onCloudChipClick,
  repoChipTitle, onRepoChipClick,
} = useFabChips()

async function loadCommands() {
  if (!projects.currentId) { commands.value = []; return }
  try {
    const url = `/api/terminal/commands?project=${encodeURIComponent(projects.currentId)}`
    const res = await apiFetch(url)
    const data = await res.json()
    if (data.ok) commands.value = data.data
  } catch { /* ignore */ }
}

function startPolling() {
  loadCommands()
  pollTimer = setInterval(loadCommands, 5000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// 项目切换时重新加载命令(会话列表由 TmuxSessionsTab 自管)
watch(() => projects.currentId, () => {
  commands.value = []
  if (terminal.drawerOpen) loadCommands()
})

// 抽屉开 → 轮询;关 → 停 + 收起新建表单
watch(() => terminal.drawerOpen, (open) => {
  if (open) startPolling()
  else { stopPolling(); showNewTmux.value = false }
})

onMounted(() => {
  if (terminal.drawerOpen) startPolling()
})
onUnmounted(() => {
  stopPolling()
})

/** 底部「＋ 新建 Tmux」:切到会话 Tab 并展开表单(再点收起;清空输入在子组件) */
function onNewTmux() {
  activeTab.value = 'tmux'
  showNewTmux.value = !showNewTmux.value
}

function onClickCommand(cmd: any) {
  terminal.createSession(cmd.label, cmd.command, cmd.cwd || '')
}
</script>

<template>
  <div class="command-drawer-root">
    <!-- 左侧终端数字芯片：灰=活跃，绿呼吸=最小化；点它恢复/置顶窗口 -->
    <div
      v-if="sessionList.length"
      class="cmd-chips-bar"
      :style="{ right: chipsBarRight + 'px', top: btnY + 'px' }"
    >
      <button
        v-for="([port, s], i) in sessionList"
        :key="port"
        class="cmd-chip"
        :class="{ minimized: s.minimized }"
        :title="(s.minimized ? '恢复：' : '切换到：') + s.label"
        @click="onChipClick(port)"
      >{{ i + 1 }}</button>
    </div>

    <!-- FAB 主触发：仍是命令抽屉开关（拖拽与点击分离：>3px 算拖，否则开抽屉） -->
    <button
      class="drawer-trigger"
      :class="{ active: terminal.drawerOpen }"
      :style="{ right: btnX + 'px', top: btnY + 'px' }"
      :title="terminal.drawerOpen ? '关闭抽屉' : '命令终端'"
      @mousedown.prevent="onTriggerDragStart"
      @click="onTriggerClick"
    >
      <span class="fab-emoji">💻</span>
      <span v-if="sessionList.length" class="drawer-badge-count">{{ sessionList.length }}</span>
    </button>

    <!-- 右侧 📂 仓库浏览芯片：点击开关 Repo Browser -->
    <div
      class="cmd-repo-bar"
      :style="{ right: repoChipRight + 'px', top: btnY + 'px' }"
    >
      <button
        class="cmd-repo-chip"
        :class="{ closed: !browser.visible, minimized: browser.visible && browser.minimized }"
        :title="repoChipTitle"
        @click="onRepoChipClick"
      >📂</button>
    </div>

    <!-- 最右侧 ☁ 云文件芯片：上传给机器 / 下载 AI 产物 -->
    <div
      class="cmd-cloud-bar"
      :style="{ right: cloudChipRight + 'px', top: btnY + 'px' }"
    >
      <button
        class="cmd-cloud-chip"
        :class="{ on: cloud.isOpen }"
        :title="cloud.isOpen ? '关闭云文件' : '云文件(上传 / 下载)'"
        @click="onCloudChipClick"
      >☁</button>
    </div>

    <Teleport to="body">
      <div v-if="terminal.drawerOpen" class="drawer-backdrop" @click="terminal.closeDrawer()" />
      <div v-if="terminal.drawerOpen" class="drawer-panel" @click.stop>
        <!-- 固定头部 -->
        <div class="drawer-header">
          <span class="drawer-title">命令终端</span>
          <button class="drawer-close" @click="terminal.closeDrawer()">✕</button>
        </div>

        <!-- 固定 Tab 栏:自定义 / 会话 / 系统 -->
        <div class="drawer-tabs">
          <button class="tab-btn" :class="{ active: activeTab === 'custom' }" @click="activeTab = 'custom'">自定义</button>
          <button class="tab-btn" :class="{ active: activeTab === 'tmux' }" @click="activeTab = 'tmux'">会话</button>
          <button class="tab-btn" :class="{ active: activeTab === 'system' }" @click="activeTab = 'system'">系统</button>
        </div>

        <!-- 滚动内容区 -->
        <div class="drawer-scroll">
          <!-- 自定义 Tab(命令由 .code-panel/commands.yaml 配置,纯展示+运行) -->
          <template v-if="activeTab === 'custom'">
            <div v-if="customCmds.length === 0" class="section-hint">
              暂无自定义命令 —— 在项目 .code-panel/commands.yaml 里加
            </div>
            <template v-for="[sub, list] in groupedCustomCmds" :key="sub || '__default__'">
              <div class="subgroup-head">
                <span class="subgroup-name">{{ sub || '未分组' }}</span>
                <span class="subgroup-count">{{ list.length }}</span>
              </div>
              <div class="cmd-grid">
                <button
                  v-for="cmd in list" :key="cmd.id"
                  class="cmd-btn" :title="cmd.command"
                  @click="onClickCommand(cmd)"
                >
                  <span class="cmd-label">{{ cmd.label }}</span>
                </button>
              </div>
            </template>
          </template>

          <!-- 系统 Tab -->
          <template v-if="activeTab === 'system'">
            <div class="cmd-grid">
              <button
                v-for="cmd in systemCmds" :key="cmd.id"
                class="cmd-btn" :title="cmd.command"
                @click="onClickCommand(cmd)"
              >
                <span class="cmd-label">{{ cmd.label }}</span>
              </button>
            </div>
          </template>

          <!-- 会话 Tab(Tmux 持久化终端,自管列表/表单/轮询) -->
          <template v-if="activeTab === 'tmux'">
            <TmuxSessionsTab :show-form="showNewTmux" @update:show-form="showNewTmux = $event" />
          </template>
        </div>

        <!-- 固定底部:左「新建 Tmux」右「启动终端」 -->
        <div class="drawer-footer">
          <button
            class="launch-btn tmux-new"
            :class="{ on: showNewTmux }"
            @click="onNewTmux"
          >{{ showNewTmux ? '− 取消新建' : '＋ 新建 Tmux 会话' }}</button>
          <button class="launch-btn" @click="terminal.createSession('终端', '', '')">+ 启动终端</button>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
/* ── 触发按钮（玻璃拟态，右下角簇主键）─────────────── */
.drawer-trigger {
  position: fixed;
  z-index: 9990;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: rgba(30,30,50,0.85);
  color: rgba(255,255,255,0.7);
  border: 1px solid rgba(255,255,255,0.1);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: color 0.2s, border-color 0.2s, background 0.2s, box-shadow 0.2s;
  user-select: none;
}
.drawer-trigger:active { cursor: grabbing; }
.drawer-trigger:hover {
  color: #fff;
  background: rgba(68,153,238,0.2);
  border-color: rgba(68,153,238,0.4);
  box-shadow: 0 4px 16px rgba(68,153,238,0.25);
}
.drawer-trigger.active {
  color: #22ee66;
  border-color: rgba(34,238,102,0.5);
  box-shadow: 0 4px 16px rgba(34,238,102,0.2);
}
.drawer-badge-count {
  position: absolute; top: -4px; right: -4px;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: #ee4444; color: #fff; font-size: 10px; font-weight: 600;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  line-height: 1;
}

/* ── 左侧终端数字芯片条：贴在 FAB 左侧等高垂直居中 ── */
.cmd-chips-bar {
  position: fixed;
  z-index: 9989;
  display: flex; align-items: center; gap: 5px;
  height: 44px;              /* 与 FAB 等高 → 芯片垂直居中 */
  pointer-events: none;      /* 容器不拦事件，芯片单独接收点击 */
}
.cmd-chip {
  pointer-events: auto;
  width: 35px; height: 35px; border-radius: 50%;
  background: rgba(50,50,68,0.7); color: rgba(255,255,255,0.35);
  border: 1px solid rgba(255,255,255,0.06);
  font-size: 15px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.1s, box-shadow 0.2s;
}
/* 活跃：灰色低调 */
.cmd-chip:hover {
  background: rgba(68,153,238,0.2); color: #ccc;
  border-color: rgba(68,153,238,0.3);
  transform: scale(1.05);
}
/* 最小化：亮色醒目，绿色呼吸 */
.cmd-chip.minimized {
  background: rgba(30,30,50,0.85); color: rgba(255,255,255,0.75);
  border: 1px solid rgba(34,238,102,0.35);
  animation: chip-online 2.4s ease-in-out infinite;
}
.cmd-chip.minimized:hover {
  background: rgba(68,153,238,0.25); color: #fff;
  border-color: rgba(68,153,238,0.6);
  transform: scale(1.1);
  animation: none;
}
@keyframes chip-online {
  0%, 100% { border-color: rgba(34,238,102,0.3);  box-shadow: 0 0 0 rgba(34,238,102,0); }
  50%      { border-color: rgba(34,238,102,0.85); box-shadow: 0 0 8px rgba(34,238,102,0.45); }
}

/* ── 右侧 📂 仓库芯片条 / 最外侧 ☁ 云芯片条 ─────────── */
.cmd-repo-bar,
.cmd-cloud-bar {
  position: fixed;
  z-index: 9989;
  display: flex; align-items: center;
  height: 44px;             /* 与 FAB 等高 → 芯片垂直居中 */
  pointer-events: none;     /* 容器不拦事件，芯片单独接收点击 */
}
.cmd-repo-chip {
  pointer-events: auto;
  width: 35px; height: 35px; border-radius: 50%;
  background: rgba(50,50,68,0.7); color: rgba(255,255,255,0.5);
  border: 1px solid rgba(255,255,255,0.08);
  font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.1s, box-shadow 0.2s;
}
.cmd-repo-chip:hover {
  background: rgba(242,204,96,0.15); border-color: rgba(242,204,96,0.35);
  transform: scale(1.05);
}
/* 未打开：更暗 */
.cmd-repo-chip.closed {
  background: rgba(40,40,58,0.55);
  color: rgba(255,255,255,0.3);
  border-color: rgba(255,255,255,0.06);
}
.cmd-repo-chip.closed:hover {
  background: rgba(242,204,96,0.12);
  color: rgba(255,255,255,0.65);
  border-color: rgba(242,204,96,0.3);
  transform: scale(1.05);
}
/* 最小化：金色呼吸 */
.cmd-repo-chip.minimized {
  background: rgba(30,30,50,0.85);
  border: 1px solid rgba(242,204,96,0.45);
  animation: repo-chip-online 2.4s ease-in-out infinite;
}
.cmd-repo-chip.minimized:hover {
  background: rgba(242,204,96,0.25); color: #fff;
  border-color: rgba(242,204,96,0.8);
  transform: scale(1.1);
  animation: none;
}
@keyframes repo-chip-online {
  0%, 100% { border-color: rgba(242,204,96,0.3);  box-shadow: 0 0 0 rgba(242,204,96,0); }
  50%      { border-color: rgba(242,204,96,0.85); box-shadow: 0 0 8px rgba(242,204,96,0.45); }
}

/* ── ☁ 云芯片 ───────────────────────────────────────── */
.cmd-cloud-chip {
  pointer-events: auto;
  width: 35px; height: 35px; border-radius: 50%;
  background: rgba(50,50,68,0.7); color: rgba(255,255,255,0.55);
  border: 1px solid rgba(255,255,255,0.08);
  font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.1s, box-shadow 0.2s;
}
.cmd-cloud-chip:hover {
  background: rgba(68,153,238,0.18); color: #fff;
  border-color: rgba(68,153,238,0.45);
  transform: scale(1.05);
}
.cmd-cloud-chip.on {
  color: #22ee66;
  border-color: rgba(34,238,102,0.5);
  background: rgba(34,238,102,0.12);
  box-shadow: 0 0 8px rgba(34,238,102,0.25);
}

/* ── 抽屉 ─────────────────────────────────────────────── */
.drawer-backdrop {
  position: fixed; inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.3);
}
.drawer-panel {
  position: fixed;
  top: 0; right: 0;
  width: 368px; height: 100vh;   /* 2026-09-07 收窄 20%(460→368) */
  z-index: 10001;
  background: var(--surface, #131316);
  border-left: 1px solid var(--border, #23232a);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 16px rgba(0,0,0,0.3);
  animation: slideIn 0.2s ease;
}
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

/* ── 固定头部 ─────────────────────────────────────────── */
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
}
.drawer-title { font-size: 14px; font-weight: 600; color: var(--text, #c8c8d0); }
.drawer-close { background: transparent; border: none; color: var(--text-dim, #6b6b78); cursor: pointer; font-size: 16px; }
.drawer-close:hover { color: #f44747; }

/* ── 固定 Tab ─────────────────────────────────────────── */
.drawer-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
}
.tab-btn {
  flex: 1; padding: 8px 0;
  border: none; background: transparent;
  color: var(--text-dim, #6b6b78);
  font-size: 12px; cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn.active { color: var(--glow, #22ee66); border-bottom-color: var(--glow, #22ee66); }
.tab-btn:not(.active):hover { color: var(--text, #c8c8d0); }

/* ── 滚动内容区 ────────────────────────────────────────── */
.drawer-scroll {
  flex: 1; overflow-y: auto;
  padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}

/* ── 通用 ─────────────────────────────────────────────── */
.section-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 12px; text-align: center; padding: 16px 0;
}

/* ── 子分组区块头 ─────────────────────────────────────── */
.subgroup-head {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 2px 2px;
  margin-top: 4px;
  border-bottom: 1px solid var(--border, #23232a);
}
.subgroup-head:first-child { margin-top: 0; }
.subgroup-name {
  font-size: 12px; font-weight: 600;
  color: var(--text, #c8c8d0);
  letter-spacing: 0.02em;
}
.subgroup-count {
  font-size: 10px; color: var(--text-dim, #6b6b78);
  background: rgba(255,255,255,0.05);
  border-radius: 8px; padding: 0 6px;
  line-height: 16px;
}
.cmd-label { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 底部固定按钮 ─────────────────────────────────────── */
.drawer-footer {
  position: sticky; bottom: 0;
  display: flex; gap: 8px; align-items: stretch;
  padding: 12px 0 0;
  border-top: 1px solid var(--border, #23232a);
  margin-top: auto;
}
.launch-btn {
  flex: 1 1 0; min-width: 0;
  padding: 10px;
  background: var(--bg, #09090b);
  border: 1px dashed var(--border, #23232a);
  border-radius: 6px;
  color: var(--glow, #22ee66);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.2s, background 0.2s;
}
.launch-btn:hover {
  border-color: var(--glow, #22ee66);
  background: rgba(34,238,102,0.05);
}
/* 左:新建 Tmux(次要一点;展开中 = 实心绿) */
.launch-btn.tmux-new { color: var(--text-dim, #6b6b78); }
.launch-btn.tmux-new:hover { color: var(--glow, #22ee66); }
.launch-btn.tmux-new.on {
  color: #09090b; background: var(--glow-dim, rgba(34,238,102,0.6));
  border-color: var(--glow, #22ee66); border-style: solid;
}

/* ── 命令按钮:一行两个 ───────────────────────────────── */
.cmd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.cmd-btn {
  min-width: 0;
  min-height: 56px;
  padding: 12px 14px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 14px;
  color: var(--text, #c8c8d0);
  cursor: pointer; text-align: left;
  display: flex; align-items: center;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}
.cmd-btn .cmd-label {
  font-size: 13px; line-height: 1.35;
  word-break: break-word;
  white-space: normal;   /* 允许两行,不受通用 nowrap 影响 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cmd-btn:hover {
  border-color: var(--glow, #22ee66);
  background: rgba(34,238,102,0.05);
}

/* 💻 图标按钮 */
.drawer-trigger .fab-emoji {
  font-size: 26px; line-height: 1;
  filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));
}
</style>
