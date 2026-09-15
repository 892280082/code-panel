<script setup lang="ts">
// ── 系统资源监控(CPU / 内存 / 进程 TOP30)─────────────────
//   移植自 code-server SystemResourceMonitor.vue。
//   内联触发:CPU / 内存两个小圆环;点开弹窗看 30 点曲线 + 进程表。
//   后端:GET /api/resources 与 GET /api/resources/processes(登录保护后)。

import { useOverlayLayer } from '@/utils/z-layer'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { apiFetch } from '@/utils/api-fetch'

interface ResourceData {
  cpu: { percent: number; cores: number; load1: number }
  memory: { percent: number; usedGB: string; totalGB: string }
  disk: { percent: number; usedGB: string; totalGB: string; mount: string }
}

interface ProcessInfo {
  pid: number
  name: string
  memPercent: number
  rssMB: number
  cpuPercent: number
}

const data = ref<ResourceData | null>(null)
const processes = ref<ProcessInfo[]>([])
const error = ref(false)
const procError = ref(false)
const showModal = ref(false)

// History for line charts (last 30 points = 5 minutes)
const MAX_HISTORY = 30
const cpuHistory = ref<number[]>([])
const memHistory = ref<number[]>([])

let timer: ReturnType<typeof setInterval> | null = null

async function fetchResources() {
  try {
    const res = await apiFetch('/api/resources')
    if (res.ok) {
      const d = await res.json() as ResourceData
      data.value = d
      error.value = false
      // Append to history
      cpuHistory.value = [...cpuHistory.value, d.cpu.percent].slice(-MAX_HISTORY)
      memHistory.value = [...memHistory.value, d.memory.percent].slice(-MAX_HISTORY)
    } else {
      error.value = true
    }
  } catch {
    error.value = true
  }
}

async function fetchProcesses() {
  try {
    const res = await apiFetch('/api/resources/processes')
    if (res.ok) {
      const d = await res.json()
      processes.value = d.processes || []
      procError.value = false
    } else {
      procError.value = true
    }
  } catch {
    procError.value = true
  }
}

function toggleModal() {
  showModal.value = !showModal.value
  if (showModal.value && processes.value.length === 0 && !procError.value) {
    fetchProcesses()
  }
}

function closeModal() {
  showModal.value = false
}

onMounted(() => {
  fetchResources()
  timer = setInterval(fetchResources, 10_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// ── SVG circle progress helpers ──
const R = 9
const CIRC = 2 * Math.PI * R

function circleDash(v: number): string {
  const len = (v / 100) * CIRC
  return `${len} ${CIRC - len}`
}

function circleColor(v: number, base: string): string {
  if (v >= 90) return 'var(--danger)'
  if (v >= 70) return 'var(--warn)'
  return base
}

// ── Line chart helpers ──
const CHART_W = 300
const CHART_H = 48

function polylinePoints(history: number[]): string {
  if (history.length < 2) return ''
  const n = history.length
  const max = Math.max(...history, 10)
  const min = Math.min(...history, 0)
  const range = max - min || 1
  return history.map((v, i) => {
    const x = (i / (n - 1)) * CHART_W
    const y = CHART_H - ((v - min) / range) * CHART_H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

// Inline circle metrics
const diskFreeGB = computed(() => {
  if (!data.value) return '—'
  const free = parseFloat(data.value.disk.totalGB) - parseFloat(data.value.disk.usedGB)
  return free.toFixed(1)
})

const circleMetrics = computed(() => {
  if (!data.value) return []
  return [
    { key: 'cpu', percent: data.value.cpu.percent, color: 'var(--info)' },
    { key: 'mem', percent: data.value.memory.percent, color: '#e05588' },
  ]
})
const { zIndex, onRaise } = useOverlayLayer(() => showModal.value)
</script>

<template>
  <!-- Inline trigger: two circle indicators -->
  <span class="sysmon-inline" @click="toggleModal" title="系统资源">
    <svg
      v-for="m in circleMetrics"
      :key="m.key"
      width="20" height="20" class="sysmon-ring"
    >
      <circle cx="10" cy="10" :r="R" fill="none" style="stroke: var(--border)" stroke-width="2" />
      <circle
        cx="10" cy="10" :r="R" fill="none"
        :style="{ stroke: circleColor(m.percent, m.color) }"
        stroke-width="2"
        stroke-linecap="round"
        :stroke-dasharray="circleDash(m.percent)"
        transform="rotate(-90 10 10)"
        style="transition: stroke-dasharray 0.8s ease, stroke 0.4s ease;"
      />
      <text x="10" y="12.5" text-anchor="middle" font-size="7" font-weight="700" fill="var(--text)" font-family="'Fira Code',monospace">{{ Math.round(m.percent) }}</text>
    </svg>
    <span v-if="error && !data" class="sysmon-inline-err" title="无法获取资源数据">⚠</span>
    <span v-else-if="!data" class="sysmon-inline-loading">···</span>
  </span>

  <!-- Detail modal -->
  <Teleport to="body">
    <div v-if="showModal" class="sysmon-overlay" :style="{ zIndex }" @pointerdown.capture="onRaise" @click.self="closeModal">
      <div class="sysmon-modal" @click.stop>
        <!-- Header -->
        <div class="sysmon-modal-header">
          <span>⏣ 系统资源</span>
          <button class="sysmon-close-btn" @click="closeModal">✕</button>
        </div>

        <div class="sysmon-modal-body">
          <!-- CPU section -->
          <div class="sysmon-section">
            <div class="sysmon-section-title">
              <span class="sysmon-indicator" style="background:var(--info)"></span>
              CPU
              <span v-if="data" class="sysmon-section-val">{{ data.cpu.percent }}%</span>
              <span v-if="data" class="sysmon-section-sub">{{ data.cpu.cores }}核 · 负载 {{ data.cpu.load1 }}</span>
            </div>
            <svg v-if="cpuHistory.length >= 2" viewBox="0 0 300 48" preserveAspectRatio="none" class="sysmon-chart">
              <polyline
                :points="polylinePoints(cpuHistory)"
                fill="none" stroke="var(--info)" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"
              />
            </svg>
            <div v-else class="sysmon-chart-empty">等待数据...</div>
          </div>

          <!-- MEM section -->
          <div class="sysmon-section">
            <div class="sysmon-section-title">
              <span class="sysmon-indicator" style="background:#e05588"></span>
              内存
              <span v-if="data" class="sysmon-section-val">{{ data.memory.percent }}%</span>
              <span v-if="data" class="sysmon-section-sub">{{ data.memory.usedGB }}/{{ data.memory.totalGB }} GB</span>
            </div>
            <svg v-if="memHistory.length >= 2" viewBox="0 0 300 48" preserveAspectRatio="none" class="sysmon-chart">
              <polyline
                :points="polylinePoints(memHistory)"
                fill="none" stroke="#e05588" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"
              />
            </svg>
            <div v-else class="sysmon-chart-empty">等待数据...</div>
          </div>

          <!-- DISK section -->
          <div class="sysmon-section">
            <div class="sysmon-section-title">
              <span class="sysmon-indicator" style="background:var(--glow)"></span>
              磁盘
              <span v-if="data" class="sysmon-section-val">{{ data.disk.percent }}%</span>
              <span v-if="data" class="sysmon-section-sub">剩余 {{ diskFreeGB }}/{{ data.disk.totalGB }} GB · {{ data.disk.mount }}</span>
            </div>
            <div class="sysmon-diskbar">
              <div class="sysmon-diskbar-fill" :style="{ width: (data?.disk.percent ?? 0) + '%', background: circleColor(data?.disk.percent ?? 0, 'var(--glow)') }" />
            </div>
          </div>

          <!-- Process table -->
          <div class="sysmon-section">
            <div class="sysmon-section-title">
              📋 进程 TOP 30（内存占用）
              <button
                v-if="procError || processes.length === 0"
                class="sysmon-reload-btn"
                @click="fetchProcesses()"
                title="重新加载"
              >↻</button>
            </div>
            <div v-if="procError" class="sysmon-proc-error">无法获取进程列表（需重启服务后生效）</div>
            <div v-else-if="processes.length === 0" class="sysmon-proc-loading">加载中...</div>
            <div v-else class="sysmon-proc-table-wrapper">
              <table class="sysmon-proc-table">
                <thead>
                  <tr>
                    <th>PID</th>
                    <th>进程名</th>
                    <th class="num">RSS</th>
                    <th class="num">内存%</th>
                    <th class="num">CPU%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in processes" :key="p.pid">
                    <td class="pid">{{ p.pid }}</td>
                    <td class="name" :title="p.name">{{ p.name }}</td>
                    <td class="num">{{ p.rssMB }}<span class="unit">MB</span></td>
                    <td class="num">
                      <span :style="{ color: circleColor(p.memPercent, '#e05588') }">{{ p.memPercent }}%</span>
                    </td>
                    <td class="num">{{ p.cpuPercent }}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Inline trigger ── */
.sysmon-inline {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.15s;
  user-select: none;
  flex-shrink: 0;
}
.sysmon-inline:hover {
  opacity: 1;
}
.sysmon-ring {
  display: block;
}
.sysmon-inline-err {
  font-size: 12px;
  color: var(--danger);
}
.sysmon-inline-loading {
  font-size: 9px;
  color: var(--text-dim);
  animation: sysmon-pulse 1.5s ease-in-out infinite;
}

@keyframes sysmon-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

/* ── Modal overlay ── */
.sysmon-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.sysmon-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  width: 440px;
  max-height: 78vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sysmon-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sysmon-close-btn {
  font-family: var(--font);
  font-size: 12px;
  padding: 3px 8px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.sysmon-close-btn:hover {
  color: var(--danger);
  border-color: var(--danger);
}

/* ── Modal body ── */
.sysmon-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sysmon-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg);
}

.sysmon-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}

.sysmon-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sysmon-section-val {
  font-weight: 700;
  font-size: 13px;
  color: var(--text);
}

.sysmon-section-sub {
  font-size: 9px;
  color: var(--text-dim);
  margin-left: auto;
}

/* ── Mini line chart ── */
.sysmon-chart {
  display: block;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  overflow: hidden;
}

.sysmon-diskbar { height: 10px; border-radius: 5px; background: rgba(255,255,255,0.06); overflow: hidden; }
.sysmon-diskbar-fill { height: 100%; border-radius: 5px; transition: width 0.8s ease, background 0.4s ease; }
.sysmon-chart-empty {
  font-size: 9px;
  color: var(--text-dim);
  text-align: center;
  padding: 14px 0;
  opacity: 0.5;
}

/* ── Process table ── */
.sysmon-reload-btn {
  font-family: var(--font);
  font-size: 10px;
  padding: 1px 6px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  margin-left: auto;
}
.sysmon-reload-btn:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.sysmon-proc-error,
.sysmon-proc-loading {
  font-size: 10px;
  color: var(--text-dim);
  text-align: center;
  padding: 16px 0;
}
.sysmon-proc-error {
  color: var(--danger);
}

.sysmon-proc-table-wrapper {
  max-height: 280px;
  overflow-y: auto;
  border-radius: 4px;
}
.sysmon-proc-table-wrapper::-webkit-scrollbar {
  width: 4px;
}
.sysmon-proc-table-wrapper::-webkit-scrollbar-track {
  background: transparent;
}
.sysmon-proc-table-wrapper::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.sysmon-proc-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 10px;
}

.sysmon-proc-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.sysmon-proc-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-dim);
  padding: 5px 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 9px;
  letter-spacing: 0.02em;
}

.sysmon-proc-table th.num {
  text-align: right;
}

.sysmon-proc-table td {
  padding: 4px 8px;
  color: var(--text);
  border-bottom: 1px solid rgba(var(--line-rgb), 0.3);
}

.sysmon-proc-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sysmon-proc-table td.pid {
  color: var(--text-dim);
  font-size: 9px;
}

.sysmon-proc-table td.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.sysmon-proc-table td .unit {
  font-size: 8px;
  color: var(--text-dim);
  margin-left: 1px;
}

.sysmon-proc-table tr:hover td {
  background: rgba(255, 255, 255, 0.02);
}
</style>
