<script setup lang="ts">
import { useTerminalStore } from '@/stores/terminal'

const store = useTerminalStore()

// ── 拖拽 ────────────────────────────────────────
let dragPort: number | null = null
let dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0

function onDragStart(e: MouseEvent, port: number) {
  dragPort = port
  dragStartX = e.clientX; dragStartY = e.clientY
  const s = store.sessions.get(port)
  if (s) { dragOrigX = s.x; dragOrigY = s.y }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (dragPort === null) return
  e.preventDefault()
  const s = store.sessions.get(dragPort)
  if (!s) return
  s.x = dragOrigX + (e.clientX - dragStartX)
  s.y = dragOrigY + (e.clientY - dragStartY)
}

function onDragEnd() {
  if (dragPort !== null) {
    const s = store.sessions.get(dragPort)
    if (s) localStorage.setItem(`cmd-terminal-pos-${dragPort}`, JSON.stringify({ x: s.x, y: s.y }))
  }
  dragPort = null
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}
</script>

<template>
  <div
    v-for="[port, session] in store.sessions"
    :key="port"
    v-show="!session.minimized"
    class="terminal-panel"
    :style="{ transform: `translate(calc(-50% + ${session.x}px), calc(-50% + ${session.y}px))` }"
  >
    <div class="terminal-header" @mousedown.prevent="(e) => onDragStart(e, port)">
      <span class="terminal-title">▸ {{ session.label }}</span>
      <div class="terminal-actions">
        <button class="btn-minimize" title="最小化" @mousedown.stop @click="store.minimizeSession(port)">─</button>
        <button class="btn-close" title="关闭" @mousedown.stop @click="store.closeSession(port)">✕</button>
      </div>
    </div>
    <div class="terminal-body">
      <iframe
        :src="`/api/terminal/${port}/`"
        class="terminal-iframe"
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
  z-index: 9990;
}
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg, #09090b);
  border-bottom: 1px solid var(--border, #23232a);
  cursor: grab;
  user-select: none;
}
.terminal-header:active { cursor: grabbing; }
.terminal-title {
  font-size: 12px; font-weight: 600;
  color: var(--text-dim, #6b6b78);
  letter-spacing: 0.05em;
  pointer-events: none;
}
.terminal-actions { display: flex; gap: 4px; pointer-events: auto; }
.btn-minimize, .btn-close {
  width: 24px; height: 24px;
  border: none; background: transparent;
  color: var(--text-dim, #6b6b78);
  cursor: pointer; border-radius: 4px;
  font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}
.btn-minimize:hover { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.05); }
.btn-close:hover { color: #f44747; background: rgba(255,68,68,0.1); }
.terminal-body {
  flex: 1; background: #000;
  position: relative; overflow: hidden;
}
.terminal-iframe {
  width: 100%; height: 100%; border: none;
}
</style>
