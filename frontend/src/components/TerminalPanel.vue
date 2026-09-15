<script setup lang="ts">
// ── 终端窗口渲染(TerminalPanel)───────────────────────
//   职责单一:渲染窗口卡片(标题栏 ⧉ ─ □ ✕ / iframe)+ 置顶激活 +
//   抓屏归属解析 + iframe 内快捷键转发。
//   标题栏拖拽 → composables/useTerminalDrag.ts;
//   切分辨率布局 → composables/useTerminalViewport.ts;
//   窗口生命周期/持久化 → stores/terminal.ts。

import { useTerminalStore } from '@/stores/terminal'
import type { TerminalSession } from '@/stores/terminal'
import { useAuthStore } from '@/stores/auth'
import { useTerminalDrag } from '@/composables/useTerminalDrag'
import { useTerminalViewport } from '@/composables/useTerminalViewport'
import { getHotkeys, eventCombo } from '@/utils/hotkeys'
import { computed } from 'vue'

const store = useTerminalStore()
const auth = useAuthStore()

// 标题栏拖动(composable 自理:per-port 记忆/清单持久化/📍 定位快照)
const { onDragStart } = useTerminalDrag()
// 切分辨率:记过位对齐档案槽位,没记过出界重置(挂载/卸载自理)
useTerminalViewport()

// 点击/触碰窗口 = 置顶;一次性(启停)会话在 2s 展示期内点中 = 用户想保留看它 → 激活
// (取消自动收起/20s 自动关),窗口一直留着可看、手动 ✕ 才关。没点中 → 2s 自动收起成 chip。
function onWindowPointerDown(port: number, session: TerminalSession) {
  store.bringToFront(port)
  if (session?.oneshot && !session.activated) store.markActivated(port)
}

/** 终端 iframe 加载完成:注入快捷键转发监听。
 *  ⭐ 焦点在终端(ttyd/xterm)里时,按键事件被 iframe 吞掉,父窗口的
 *  全局热键收不到 —— 必须在 iframe 内也监听(同源,可挂)。
 *  ⭐⭐ 捕获阶段挂载:xterm 自己的按键处理即便 stopPropagation 也
 *  拦不住捕获;先于它拿到事件。 */
function onFrameLoad(e: Event): void {
  const win = (e.target as HTMLIFrameElement).contentWindow
  if (!win) return
  try {
    win.addEventListener('keydown', (ev: KeyboardEvent) => {
      const combo = eventCombo(ev)
      if (combo && combo === getHotkeys().toggleTerm) {
        ev.preventDefault()
        store.toggleTmuxVisibility()
      }
    }, true)
  } catch { /* 理论同源不会跨域;异常则仅父窗口热键生效 */ }
}

/** 抓屏要用的归属项目:新窗口直接取字段;旧窗口(本次升级前开的)没存 →
 *  从物理名 p_<projectId>_<name> 第二段解析兜底(projectId 为数字串,无下划线) */
function tmuxProjectOf(s: TerminalSession): string | null {
  if (s.tmuxProject) return s.tmuxProject
  const m = /^p_([A-Za-z0-9-]+)_/.exec(s.tmuxSession || '')
  return m ? m[1] : null
}

/** tmux 会话有序端口表 —— 与 FAB 数字芯片条(useFabChips.sessionList)同源同序,
 *  窗口标题的圆框编号取自此表,关掉中间窗口两边同步重排,永远一一对应。
 *  ⚠ 同源 = 都取「当前视角可见」的窗口(visibleEntries),编号才对得上芯片。 */
const tmuxPorts = computed(() =>
  store.visibleEntries.filter(([, s]) => s.kind === 'tmux').map(([port]) => port),
)

/** 窗口标题徽章编号(tmux = 在数字条中的序号;cmd/一次性窗口不占号,无徽章) */
function badgeNo(port: number): number {
  return tmuxPorts.value.indexOf(port) + 1
}
</script>

<template>
  <div
    v-for="[port, session] in store.sessions"
    :key="port"
    v-show="!session.minimized && store.inView(session)"
    class="terminal-panel"
    :class="{ maximized: session.maximized }"
    :style="session.maximized
      ? { zIndex: session.zIndex }
      : {
          zIndex: session.zIndex,
          transform: `translate(calc(-50% + ${session.x}px), calc(-50% + ${session.y}px))`,
        }"
    @pointerdown.capture="onWindowPointerDown(port, session)"
  >
    <!-- 标题栏拖拽走 pointerdown + setPointerCapture(useTerminalDrag):
         鼠标拖进终端 iframe 区域也不丢事件(iframe 是独立文档,mousemove 收不到 → 之前不跟手) -->
    <div class="terminal-header" @pointerdown.prevent="(e) => onDragStart(e, port)">
      <span class="terminal-title">
        <span v-if="session.kind === 'tmux'" class="title-badge" :title="`终端 ${badgeNo(port)}(对应右下角数字芯片)`">{{ badgeNo(port) }}</span>
        <span v-if="store.showProjChip(session)" class="proj-chip" :title="`归属项目:${store.projNameOf(session)}`">{{ store.projNameOf(session) }}</span>
        ▸ {{ session.label }}
      </span>
      <div class="terminal-actions">
        <!-- ⧉ 复制屏幕:tmux mouse on 截获网页拖选 → 抓屏弹窗是唯一可靠复制通道(仅 tmux 会话) -->
        <button
          v-if="session.kind === 'tmux' && session.tmuxSession && tmuxProjectOf(session)"
          class="btn-copy"
          title="复制屏幕文本(弹窗里可拖选局部 / 一键复制)"
          @pointerdown.stop
          @click.stop="store.openCapture({ fullName: session.tmuxSession!, label: session.label, project: tmuxProjectOf(session)! })"
        >⧉</button>
        <button class="btn-minimize" title="最小化" @pointerdown.stop @click.stop="store.minimizeSession(port)">─</button>
        <button
          class="btn-maximize"
          :title="session.maximized ? '还原' : '最大化'"
          @pointerdown.stop
          @click.stop="store.toggleMaximizeSession(port)"
        >{{ session.maximized ? '❐' : '□' }}</button>
        <button class="btn-close" title="关闭" @pointerdown.stop @click.stop="store.closeSession(port)">✕</button>
      </div>
    </div>
    <div class="terminal-body">
      <iframe
        v-if="!session.minimized"
        :src="`/api/terminal/${port}/?token=${auth.token}`"
        class="terminal-iframe"
        @load="onFrameLoad"
      />
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  position: fixed;
  top: 50%; left: 50%;
  width: 900px;
  max-width: calc(100vw - 48px);
  height: 580px;
  max-height: calc(100vh - 48px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  display: flex; flex-direction: column;
  overflow: hidden;
  transition: box-shadow 0.15s;
}
.terminal-panel:hover { box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
/* □ 最大化：铺满视口、去圆角去边框，还原时去掉本类即回到原几何。
   z 仍用 session.zIndex（~1000 级），FAB/芯片(9990)保持在上层，随时可再操作 */
.terminal-panel.maximized {
  top: 0; left: 0;
  width: 100vw; height: 100vh;
  max-width: none; max-height: none;
  transform: none;
  border-radius: 0;
  border: none;
}
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg, #09090b);
  border-bottom: 1px solid var(--border, #23232a);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  touch-action: none; /* 触摸拖动时不许浏览器抢去滚动/缩放(指针捕获的前提) */
}
.terminal-panel.maximized .terminal-header { cursor: default; }
.terminal-title {
  font-size: 12px; font-weight: 600;
  color: var(--text-dim, #6b6b78);
  letter-spacing: 0.05em;
  pointer-events: none;
}
/* 标题前圆框编号:对应右下角 FAB 数字芯片条(tmux 窗口才有);
   颜色跟标题同灰(和谐,不抢眼) */
/* 🌐 归属项目徽标:全局视角下标明窗口属于哪个项目(区分"谁的终端") */
.proj-chip {
  display: inline-block;
  font-size: 10px; line-height: 1;
  padding: 2px 6px; margin-right: 5px;
  border-radius: 4px;
  background: rgba(103, 194, 58, 0.12);
  border: 1px solid rgba(103, 194, 58, 0.35);
  color: #95d475;
  vertical-align: middle;
  white-space: nowrap;
}

.title-badge {
  display: inline-flex;
  align-items: center; justify-content: center;
  width: 16px; height: 16px;
  margin-right: 5px;
  border: 1px solid var(--border, #2c2c33);
  border-radius: 50%;
  color: var(--text-dim, #6b6b78);
  font-family: 'Fira Code', monospace;
  font-size: 9px; font-weight: 700;
  vertical-align: -3px;
}
.terminal-actions { display: flex; gap: 4px; pointer-events: auto; }
.btn-copy, .btn-minimize, .btn-maximize, .btn-close {
  width: 24px; height: 24px;
  border: none; background: transparent;
  color: var(--text-dim, #6b6b78);
  cursor: pointer; border-radius: 4px;
  font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
  transition: all 0.15s;
}
.btn-minimize:hover, .btn-maximize:hover { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.08); }
.btn-copy:hover { color: var(--glow, #22ee66); background: rgba(var(--glow-rgb),0.12); }
.btn-maximize:hover { color: #f2cc60; background: rgba(242,204,96,0.12); }
.btn-close:hover { color: var(--danger); background: rgba(var(--danger-rgb),0.1); }
.terminal-body {
  flex: 1; background: #000;
  position: relative; overflow: hidden;
}
.terminal-iframe {
  width: 100%; height: 100%; border: none;
}
</style>
