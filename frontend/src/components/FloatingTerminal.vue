<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const minimized = ref(false)
const status = ref<'running' | 'restarting' | 'stopped' | 'loading'>('loading')
const message = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

// ── 拖拽位置 ──────────────────────────────────────────
const POS_KEY = 'terminal-fab-pos'
const FAB_SIZE = 44
const EDGE = 8

/** 屏幕分辨率变化后，上次记录的位置可能超出可视区域，越界则重置回屏幕内，避免图标丢失 */
function clampPos(v: { x: number; y: number } | null) {
  if (!v) return null
  const maxX = window.innerWidth - FAB_SIZE - EDGE
  const maxY = window.innerHeight - FAB_SIZE - EDGE
  if (maxX < EDGE || maxY < EDGE) return null
  return { x: Math.min(Math.max(v.x, EDGE), maxX), y: Math.min(Math.max(v.y, EDGE), maxY) }
}
function readSavedPos() {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || '')
    if (v && typeof v.x === 'number' && typeof v.y === 'number') return v
  } catch { /* ignore */ }
  return null
}
const raw = readSavedPos()
const clamped = clampPos(raw)
const fabX = ref(clamped?.x ?? 24)
const fabY = ref(clamped?.y ?? 24)
// 上次记录已越界 → 用修正后的位置覆盖存储，下次打开直接是正常位置
if (raw && clamped && (raw.x !== clamped.x || raw.y !== clamped.y)) {
  localStorage.setItem(POS_KEY, JSON.stringify(clamped))
}
const dragging = ref(false)
let dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0

function onDragStart(e: MouseEvent | TouchEvent) {
  dragging.value = true
  const p = 'touches' in e ? e.touches[0] : e
  dragStartX = p.clientX; dragStartY = p.clientY
  dragOrigX = fabX.value; dragOrigY = fabY.value
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  document.addEventListener('touchmove', onDragMove, { passive: false })
  document.addEventListener('touchend', onDragEnd)
}
function onDragMove(e: MouseEvent | TouchEvent) {
  if (!dragging.value) return
  e.preventDefault()
  const p = 'touches' in e ? e.touches[0] : e
  fabX.value = dragOrigX - (p.clientX - dragStartX)
  fabY.value = dragOrigY - (p.clientY - dragStartY)
}
function onDragEnd() {
  dragging.value = false
  localStorage.setItem(POS_KEY, JSON.stringify({ x: fabX.value, y: fabY.value }))
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('touchmove', onDragMove)
  document.removeEventListener('touchend', onDragEnd)
}

// ── 终端状态轮询 ─────────────────────────────────────
async function checkStatus() {
  try {
    const res = await apiFetch('/api/terminal/status')
    const data = await res.json()
    if (data.ok) {
      status.value = data.status
      if (data.status === 'running') message.value = ''
      else if (data.status === 'restarting') message.value = '终端重连中...'
      else if (data.status === 'stopped') message.value = '终端已停止'
    }
  } catch { /* ignore */ }
}

function toggle() {
  if (!visible.value) {
    visible.value = true
    minimized.value = false
    if (status.value !== 'running') checkStatus()
  } else {
    minimized.value = !minimized.value
  }
}

function close() {
  visible.value = false
  minimized.value = false
}

function clampToViewport() {
  const c = clampPos({ x: fabX.value, y: fabY.value })
  if (c) { fabX.value = c.x; fabY.value = c.y }
}

onMounted(() => {
  checkStatus()
  pollTimer = setInterval(checkStatus, 5000)
  window.addEventListener('resize', clampToViewport)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('resize', clampToViewport)
})
</script>

<template>
  <div class="floating-terminal-root">
    <!-- 展开面板 -->
    <div v-show="visible && !minimized" class="terminal-panel">
      <div class="terminal-header">
        <span class="terminal-title">▸ Terminal</span>
        <div class="terminal-actions">
          <button class="btn-minimize" title="最小化" @click="minimized = true">─</button>
          <button class="btn-close" title="关闭" @click="close">✕</button>
        </div>
      </div>
      <div class="terminal-body">
        <div v-if="status === 'loading'" class="status-msg">连接中...</div>
        <div v-else-if="status === 'restarting'" class="status-msg">{{ message }}</div>
        <div v-else-if="status === 'stopped'" class="status-msg error">{{ message }}</div>
        <iframe
          v-show="status === 'running'"
          src="/api/terminal/"
          class="terminal-iframe"
        />
      </div>
    </div>

    <!-- 可拖拽浮动按钮 -->
    <button
      class="terminal-fab"
      :class="{ active: visible && !minimized, connected: status === 'running' }"
      :style="{ right: fabX + 'px', bottom: fabY + 'px' }"
      :title="visible && !minimized ? '最小化终端' : '打开终端'"
      @mousedown.prevent="onDragStart"
      @touchstart.prevent="onDragStart"
      @click="toggle"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
        <polyline points="6 9 12 13 18 9"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.floating-terminal-root {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  inset: 0;
}
.floating-terminal-root > * {
  pointer-events: auto;
}

/* ── 浮动按钮 ──────────────────────────────────────── */
.terminal-fab {
  position: fixed;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border, #30363d);
  background: var(--surface, #161b22);
  color: var(--text-dim, #8b949e);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: color 0.2s, border-color 0.2s, box-shadow 0.2s;
  user-select: none;
}
.terminal-fab:active {
  cursor: grabbing;
}
.terminal-fab:hover {
  color: var(--text, #c9d1d9);
  border-color: var(--glow-dim, #116633);
  box-shadow: 0 4px 16px rgba(17,102,51,0.2);
}
.terminal-fab.active {
  color: var(--glow, #22ee66);
  border-color: var(--glow, #22ee66);
}
.terminal-fab.connected {
  color: #3fb950;
  border-color: #3fb950;
}

/* ── 面板 ──────────────────────────────────────────── */
.terminal-panel {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
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
}
.terminal-actions { display: flex; gap: 4px; }
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
.status-msg {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-dim, #6b6b78); font-size: 13px;
}
.status-msg.error { color: #f44747; }
</style>
