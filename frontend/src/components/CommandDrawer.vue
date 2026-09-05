<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'

const terminal = useTerminalStore()
const projects = useProjectsStore()
const commands = ref<any[]>([])
const activeTab = ref<'custom' | 'system' | 'tmux'>('custom')
const showForm = ref(false)
const newLabel = ref('')
const newCmd = ref('')
const newCwd = ref('')
const newSubgroup = ref('')
const formError = ref('')
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
/** 已有子分组名（表单 datalist 提示用） */
const allSubgroups = computed(() =>
  Array.from(new Set(customCmds.value.map((c: any) => c.subgroup).filter(Boolean)) as Set<string>),
)

// ── 按钮拖拽 ────────────────────────────────────────
const POS_KEY = 'cmd-drawer-trigger-pos'
const BTN_SIZE = 44
const EDGE = 8

/** 屏幕分辨率变化后，上次记录的位置可能超出可视区域，越界则重置回屏幕内，避免图标丢失 */
function clampBtnPos(v: { x: number; y: number } | null) {
  if (!v) return null
  const maxX = window.innerWidth - BTN_SIZE - EDGE
  const maxY = window.innerHeight - BTN_SIZE - EDGE
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
const clamped = clampBtnPos(raw)
const btnX = ref(clamped?.x ?? 100)
const btnY = ref(clamped?.y ?? 12)
// 上次记录已越界 → 用修正后的位置覆盖存储，下次打开直接是正常位置
if (raw && clamped && (raw.x !== clamped.x || raw.y !== clamped.y)) {
  localStorage.setItem(POS_KEY, JSON.stringify(clamped))
}
let dragging = false
let dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0

/** 当前项目 id */
const currentProject = computed(() => projects.currentProject)
/** 当前项目显示名称(自定义 Tab 标题) */
const groupLabel = computed(() => projects.currentProject?.name || '自定义')

function onTriggerDragStart(e: MouseEvent) {
  if (terminal.drawerOpen) return
  dragging = true
  dragStartX = e.clientX; dragStartY = e.clientY
  dragOrigX = btnX.value; dragOrigY = btnY.value
  document.addEventListener('mousemove', onTriggerDragMove)
  document.addEventListener('mouseup', onTriggerDragEnd)
}
function onTriggerDragMove(e: MouseEvent) {
  if (!dragging) return
  e.preventDefault()
  btnX.value = dragOrigX - (e.clientX - dragStartX)
  btnY.value = dragOrigY + (e.clientY - dragStartY)
}
function onTriggerDragEnd() {
  dragging = false
  localStorage.setItem(POS_KEY, JSON.stringify({ x: btnX.value, y: btnY.value }))
  document.removeEventListener('mousemove', onTriggerDragMove)
  document.removeEventListener('mouseup', onTriggerDragEnd)
}

async function loadCommands() {
  if (!projects.currentId) { commands.value = []; return }
  try {
    const url = `/api/terminal/commands?project=${encodeURIComponent(projects.currentId)}`
    const res = await apiFetch(url)
    const data = await res.json()
    if (data.ok) commands.value = data.data
  } catch { /* ignore */ }
}

// ── Tmux 持久化会话(「会话」Tab)──────────────────────
const tmuxSessions = ref<any[]>([])
const showNewTmux = ref(false)
const newTmuxName = ref('')
const newTmuxDesc = ref('')
const tmuxError = ref('')

/** 拉取本项目 tmux 会话(后端带 project 过滤;这里再兜底过滤一次) */
async function loadTmuxSessions() {
  if (!projects.currentId) { tmuxSessions.value = []; return }
  try {
    const url = `/api/terminal/tmux/list?project=${encodeURIComponent(projects.currentId)}`
    const res = await apiFetch(url)
    const data = await res.json()
    if (data.ok) {
      const pid = projects.currentId
      tmuxSessions.value = (data.data || [])
        .filter((s: any) => s.project === pid)
        .sort((a: any, b: any) => b.createdAt - a.createdAt)
    }
  } catch { /* ignore */ }
}

/** 该 tmux 会话在本页是否已开窗口(有则返回端口,null=未连接) */
function attachedTmuxPort(fullName: string): number | null {
  for (const [port, s] of terminal.sessions) {
    if (s.kind === 'tmux' && s.tmuxSession === fullName) return port
  }
  return null
}

/** 展示名(后端已去前缀,name 为空时退化为物理名) */
function prettyTmuxName(s: any): string { return s.name || s.fullName }

async function onConnectTmux(s: any) {
  if (!projects.currentId) return
  const port = attachedTmuxPort(s.fullName)
  if (port !== null) { terminal.restoreSession(port); return }
  await terminal.attachTmux(s.fullName, prettyTmuxName(s), projects.currentId, s.description || '')
}

async function handleCreateTmux() {
  tmuxError.value = ''
  if (!projects.currentId) { tmuxError.value = '无当前项目'; return }
  if (!newTmuxName.value.trim()) { tmuxError.value = '请输入会话名称'; return }
  try {
    const res = await apiFetch('/api/terminal/tmux/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: projects.currentId,
        name: newTmuxName.value.trim(),
        description: newTmuxDesc.value.trim() || undefined,
      }),
    })
    const data = await res.json()
    if (!data.ok) { tmuxError.value = data.error || '创建失败'; return }
    const { name, fullName } = data.data
    const desc = newTmuxDesc.value.trim()
    newTmuxName.value = ''; newTmuxDesc.value = ''
    showNewTmux.value = false
    loadTmuxSessions()
    await terminal.attachTmux(fullName, name, projects.currentId!, desc)
  } catch {
    tmuxError.value = '网络错误'
  }
}

/** 断开:只 detach 本会话已开窗口(tmux 会话保留) */
function onDetachTmux(s: any) {
  const port = attachedTmuxPort(s.fullName)
  if (port !== null) terminal.closeSession(port)
}

/** 彻底删除:断开 + kill session + 清备注 */
function onDeleteTmux(s: any) {
  if (!projects.currentId) return
  if (!confirm(`确定删除 tmux 会话「${prettyTmuxName(s)}」?会话内的所有进程将被终止!`)) return
  terminal.deleteTmuxSession(s.fullName, projects.currentId).then(loadTmuxSessions)
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function startPolling() {
  loadCommands()
  loadTmuxSessions()
  pollTimer = setInterval(() => { loadCommands(); loadTmuxSessions() }, 5000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// 项目切换时重新加载命令 + tmux 会话
watch(() => projects.currentId, () => {
  commands.value = []
  tmuxSessions.value = []
  if (terminal.drawerOpen) { loadCommands(); loadTmuxSessions() }
})

watch(() => terminal.drawerOpen, (open) => {
  if (open) startPolling()
  else { stopPolling(); showForm.value = false; showNewTmux.value = false }
})

function clampToViewport() {
  const c = clampBtnPos({ x: btnX.value, y: btnY.value })
  if (c) { btnX.value = c.x; btnY.value = c.y }
}
onMounted(() => {
  if (terminal.drawerOpen) startPolling()
  window.addEventListener('resize', clampToViewport)
})
onUnmounted(() => {
  stopPolling()
  window.removeEventListener('resize', clampToViewport)
})

function onClickCommand(cmd: any) {
  terminal.createSession(cmd.label, cmd.command, cmd.cwd || '')
}

function onClickRestore(port: number) {
  terminal.restoreSession(port)
}

async function handleCreate() {
  formError.value = ''
  if (!newLabel.value.trim()) { formError.value = '请输入名称'; return }
  if (!newCmd.value.trim()) { formError.value = '请输入命令'; return }
  if (!projects.currentId) { formError.value = '无当前项目'; return }
  try {
    const res = await apiFetch(`/api/terminal/commands?project=${encodeURIComponent(projects.currentId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newLabel.value.trim(),
        command: newCmd.value.trim(),
        cwd: newCwd.value.trim() || undefined,
        subgroup: newSubgroup.value.trim() || undefined
      })
    })
    const data = await res.json()
    if (data.ok) {
      newLabel.value = ''; newCmd.value = ''; newCwd.value = ''; newSubgroup.value = ''
      showForm.value = false
      loadCommands()
    } else {
      formError.value = data.error || '创建失败'
    }
  } catch {
    formError.value = '网络错误'
  }
}

// ── 编辑弹窗 ──────────────────────────────────────────
const editingCmd = ref<any>(null)
const editLabel = ref('')
const editCmd = ref('')
const editCwd = ref('')
const editSubgroup = ref('')
const editError = ref('')

function openEdit(cmd: any) {
  editingCmd.value = cmd
  editLabel.value = cmd.label
  editCmd.value = cmd.command
  editCwd.value = cmd.cwd || ''
  editSubgroup.value = cmd.subgroup || ''
  editError.value = ''
}

async function handleEditSave() {
  editError.value = ''
  if (!editLabel.value.trim()) { editError.value = '请输入名称'; return }
  if (!editCmd.value.trim()) { editError.value = '请输入命令'; return }
  if (!projects.currentId) { editError.value = '无当前项目'; return }
  try {
    const res = await apiFetch(`/api/terminal/commands/${editingCmd.value.id}?project=${encodeURIComponent(projects.currentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: editLabel.value.trim(),
        command: editCmd.value.trim(),
        cwd: editCwd.value.trim() || undefined,
        subgroup: editSubgroup.value.trim() || undefined
      })
    })
    const data = await res.json()
    if (data.ok) {
      editingCmd.value = null
      loadCommands()
    } else {
      editError.value = data.error || '编辑失败'
    }
  } catch {
    editError.value = '网络错误'
  }
}

// ── 删除 ──────────────────────────────────────────────
async function handleDelete(cmd: any) {
  if (!confirm(`确定删除「${cmd.label}」?`)) return false
  if (!projects.currentId) return false
  await apiFetch(`/api/terminal/commands/${cmd.id}?project=${encodeURIComponent(projects.currentId)}`, { method: 'DELETE' })
  loadCommands()
  return true
}

// ── 排序（自定义命令，组内排序） ─────────────────────────
/** 在指定子分组内上移/下移命令（整体数组重新排序，保持其它命令相对顺序） */
function moveInGroup(cmd: any, dir: -1 | 1) {
  const sub = cmd.subgroup || ''
  const groupList = customCmds.value.filter((c: any) => (c.subgroup || '') === sub)
  const idx = groupList.findIndex((c: any) => c.id === cmd.id)
  if (idx === -1) return
  const target = idx + dir
  if (target < 0 || target >= groupList.length) return

  const allIds = customCmds.value.map((c: any) => c.id)
  const a = allIds.indexOf(cmd.id)
  const b = allIds.indexOf(groupList[target].id)
  const tmp = allIds[a]; allIds[a] = allIds[b]; allIds[b] = tmp
  saveReorder(allIds)
}
function moveUp(cmd: any) { moveInGroup(cmd, -1) }
function moveDown(cmd: any) { moveInGroup(cmd, 1) }
async function saveReorder(ids: string[]) {
  if (!projects.currentId) return
  await apiFetch(`/api/terminal/commands/reorder?project=${encodeURIComponent(projects.currentId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  })
  loadCommands()
}
</script>

<template>
  <div class="command-drawer-root">
    <button
      class="drawer-trigger"
      :class="{ active: terminal.drawerOpen }"
      :style="{ right: btnX + 'px', top: btnY + 'px' }"
      :title="terminal.drawerOpen ? '关闭抽屉' : '命令终端'"
      @mousedown.prevent="onTriggerDragStart"
      @click="terminal.toggleDrawer()"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="terminal.drawerOpen" class="drawer-backdrop" @click="terminal.closeDrawer()" />
      <div v-if="terminal.drawerOpen" class="drawer-panel" @click.stop>
        <!-- 固定头部 -->
        <div class="drawer-header">
          <span class="drawer-title">命令终端</span>
          <button class="drawer-close" @click="terminal.closeDrawer()">✕</button>
        </div>

        <!-- 固定 Tab 栏 -->
        <div class="drawer-tabs">
          <button class="tab-btn" :class="{ active: activeTab === 'custom' }" @click="activeTab = 'custom'">{{ groupLabel }}</button>
          <button class="tab-btn" :class="{ active: activeTab === 'system' }" @click="activeTab = 'system'">系统</button>
          <button class="tab-btn" :class="{ active: activeTab === 'tmux' }" @click="activeTab = 'tmux'">会话</button>
        </div>

        <!-- 滚动内容区 -->
        <div class="drawer-scroll">
          <!-- 自定义 Tab -->
          <template v-if="activeTab === 'custom'">
            <button class="new-btn" @click="showForm = !showForm">
              <span v-if="showForm">− 取消</span>
              <span v-else>+ 新建</span>
            </button>

            <div v-if="showForm" class="form-card">
              <input v-model="newLabel" class="form-input" placeholder="名称" @keyup.enter="handleCreate" />
              <input v-model="newCmd" class="form-input mono" placeholder="命令" @keyup.enter="handleCreate" />
              <input v-model="newCwd" class="form-input mono" placeholder="工作目录（可选）" @keyup.enter="handleCreate" />
              <input v-model="newSubgroup" class="form-input" list="cmd-subgroups" placeholder="子分组（可选，如 快速启动 / 单平台）" @keyup.enter="handleCreate" />
              <datalist id="cmd-subgroups">
                <option v-for="g in allSubgroups" :key="g" :value="g" />
              </datalist>
              <div v-if="formError" class="form-error">{{ formError }}</div>
              <button class="form-submit" @click="handleCreate">保存</button>
            </div>

            <div v-if="customCmds.length === 0 && !showForm" class="section-hint">
              暂无自定义命令，点击「+ 新建」创建
            </div>

            <!-- 按子分组聚合展示 -->
            <template v-for="[sub, list] in groupedCustomCmds" :key="sub || '__default__'">
              <div class="subgroup-head">
                <span class="subgroup-name">{{ sub || '未分组' }}</span>
                <span class="subgroup-count">{{ list.length }}</span>
              </div>
              <div v-for="cmd in list" :key="cmd.id" class="cmd-card">
                <div class="cmd-card-body" @click="onClickCommand(cmd)">
                  <span class="cmd-label">{{ cmd.label }}</span>
                  <span class="cmd-preview">{{ cmd.command }}</span>
                </div>
                <div class="cmd-card-foot">
                  <button class="foot-btn" :disabled="list.indexOf(cmd) === 0" @click.stop="moveUp(cmd)">▲</button>
                  <button class="foot-btn" :disabled="list.indexOf(cmd) === list.length - 1" @click.stop="moveDown(cmd)">▼</button>
                  <span class="foot-sep" />
                  <button class="foot-btn cfg" @click.stop="openEdit(cmd)">配置</button>
                </div>
              </div>
            </template>
          </template>

          <!-- 系统 Tab -->
          <template v-if="activeTab === 'system'">
            <button v-for="cmd in systemCmds" :key="cmd.id" class="sys-card" @click="onClickCommand(cmd)">
              <span class="cmd-label">{{ cmd.label }}</span>
              <span class="cmd-preview">{{ cmd.command }}</span>
            </button>
          </template>

          <!-- 会话 Tab(Tmux 持久化终端) -->
          <template v-if="activeTab === 'tmux'">
            <button class="new-btn" @click="showNewTmux = !showNewTmux">
              <span v-if="showNewTmux">− 取消</span>
              <span v-else>+ 新建 Tmux 会话</span>
            </button>

            <div v-if="showNewTmux" class="form-card">
              <input v-model="newTmuxName" class="form-input mono" placeholder="会话名称" @keyup.enter="handleCreateTmux" />
              <input v-model="newTmuxDesc" class="form-input" placeholder="备注（可选）" @keyup.enter="handleCreateTmux" />
              <div v-if="tmuxError" class="form-error">{{ tmuxError }}</div>
              <button class="form-submit" @click="handleCreateTmux">创建并连接</button>
            </div>

            <div v-if="tmuxSessions.length === 0 && !showNewTmux" class="section-hint">
              没有 tmux 会话。创建后终端会常驻服务器，刷新页面 / 重启服务后也能重连。
            </div>

            <div v-for="s in tmuxSessions" :key="s.fullName" class="tmux-item">
              <div class="tmux-body" @click="onConnectTmux(s)">
                <span class="cmd-label">
                  {{ prettyTmuxName(s) }}
                  <span v-if="attachedTmuxPort(s.fullName) !== null" class="tmux-badge">● 已连接</span>
                </span>
                <span class="cmd-preview">
                  {{ s.description || `${s.windows} 个窗口` }} · {{ s.attached ? '已有接入' : '空闲' }} · {{ fmtTime(s.createdAt) }}
                </span>
              </div>
              <div class="tmux-actions">
                <button v-if="attachedTmuxPort(s.fullName) !== null" class="foot-btn" @click.stop="onDetachTmux(s)">
                  断开
                </button>
                <button class="foot-btn danger" @click.stop="onDeleteTmux(s)">删除</button>
              </div>
            </div>
          </template>

          <!-- 活跃终端 -->
          <div v-if="terminal.sessions.size > 0" class="divider" />
          <button v-for="[port, session] in terminal.sessions" :key="port" class="session-item" @click="onClickRestore(port)">
            <span class="session-dot" />
            <span class="session-label">{{ session.label }}</span>
            <button class="session-close" @click.stop="terminal.closeSession(port)">✕</button>
          </button>
        </div>

        <!-- 固定底部 -->
        <div class="drawer-footer">
          <button class="launch-btn" @click="terminal.createSession('终端', '', '')">+ 启动终端</button>
        </div>
      </div>
    </Teleport>

    <!-- 配置弹窗（编辑 + 删除） -->
    <Teleport to="body">
      <div v-if="editingCmd" class="modal-backdrop" @click="editingCmd = null" />
      <div v-if="editingCmd" class="modal-dialog" @click.stop>
        <div class="modal-header">
          <span>配置命令</span>
          <button class="modal-close" @click="editingCmd = null">✕</button>
        </div>
        <div class="modal-body">
          <input v-model="editLabel" class="form-input" placeholder="名称" />
          <input v-model="editCmd" class="form-input mono" placeholder="命令" />
          <input v-model="editCwd" class="form-input mono" placeholder="工作目录（可选）" />
          <input v-model="editSubgroup" class="form-input" list="cmd-subgroups" placeholder="子分组（可选）" />
          <div v-if="editError" class="form-error">{{ editError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn-danger" @click="handleDelete(editingCmd).then(ok => { if (ok) editingCmd = null })">删除</button>
          <span class="foot-gap" />
          <button class="btn-cancel" @click="editingCmd = null">取消</button>
          <button class="btn-save" @click="handleEditSave">保存</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── 触发按钮 ────────────────────────────────────────── */
.drawer-trigger {
  position: fixed;
  z-index: 9990;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1px solid #2ea043;
  background: #238636;
  color: #f0f6fc;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: color 0.2s, border-color 0.2s, background 0.2s, box-shadow 0.2s;
  user-select: none;
}
.drawer-trigger:active { cursor: grabbing; }
.drawer-trigger:hover {
  color: #fff;
  background: #2ea043;
  border-color: #3fb950;
  box-shadow: 0 4px 16px rgba(63,185,80,0.4);
}
.drawer-trigger.active {
  color: #fff;
  background: #2ea043;
  border-color: #3fb950;
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
  width: 320px; height: 100vh;
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

/* ── 新建按钮 ─────────────────────────────────────────── */
.new-btn {
  width: 100%; padding: 8px;
  border: 1px dashed var(--border, #23232a);
  border-radius: 6px;
  background: transparent;
  color: var(--glow, #22ee66);
  font-size: 13px; cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.new-btn:hover {
  border-color: var(--glow, #22ee66);
  background: rgba(34,238,102,0.05);
}

/* ── 新建表单 ─────────────────────────────────────────── */
.form-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
}
.form-input {
  padding: 8px 10px;
  border: 1px solid var(--border, #23232a);
  border-radius: 4px;
  background: var(--surface, #131316);
  color: var(--text, #c8c8d0);
  font-size: 12px;
  outline: none;
}
.form-input:focus { border-color: var(--glow, #22ee66); }
.form-input.mono { font-family: var(--font, monospace); }
.form-error {
  color: #f44747; font-size: 11px;
}
.form-submit {
  padding: 8px;
  border: none; border-radius: 4px;
  background: var(--glow, #22ee66);
  color: #09090b; font-size: 13px; cursor: pointer;
  font-weight: 600;
  transition: opacity 0.2s;
}
.form-submit:hover { opacity: 0.85; }

/* ── 自定义命令卡片 ──────────────────────────────────── */
.cmd-card {
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.15s;
  flex-shrink: 0;
  min-height: 72px;
  display: flex; flex-direction: column;
}
.cmd-card:hover { border-color: rgba(34,238,102,0.3); }
.cmd-card-body {
  flex: 1; padding: 10px 12px 8px;
  cursor: pointer;
  overflow: hidden;
  display: flex; flex-direction: column; gap: 4px;
}
.cmd-card-body:hover { background: rgba(34,238,102,0.03); }
.cmd-card-foot {
  display: flex; align-items: center; gap: 2px;
  padding: 4px 6px;
  border-top: 1px solid var(--border, #23232a);
  background: rgba(0,0,0,0.15);
}
.foot-btn {
  padding: 2px 8px;
  border: none; background: transparent;
  color: var(--text-dim, #6b6b78);
  font-size: 10px; cursor: pointer; border-radius: 3px;
  transition: color 0.15s, background 0.15s;
}
.foot-btn:hover:not(:disabled) { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.05); }
.foot-btn:disabled { opacity: 0.25; cursor: default; }
.foot-btn.cfg:hover { color: var(--glow, #22ee66); }
.foot-sep { width: 1px; height: 12px; background: var(--border, #23232a); margin: 0 2px; }

/* ── 系统命令卡片 ──────────────────────────────────────── */
.sys-card {
  width: 100%; padding: 10px 12px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
  color: var(--text, #c8c8d0);
  cursor: pointer; text-align: left;
  display: flex; flex-direction: column; gap: 4px;
  transition: border-color 0.15s, background 0.15s;
  flex-shrink: 0;
  overflow: hidden;
}
.sys-card:hover { border-color: var(--glow, #22ee66); background: rgba(34,238,102,0.05); }

/* ── Tmux 会话列表 ─────────────────────────────────────── */
.tmux-item {
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex; flex-direction: column;
  transition: border-color 0.15s;
}
.tmux-item:hover { border-color: rgba(34,238,102,0.3); }
.tmux-body {
  padding: 10px 12px 8px;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
}
.tmux-body:hover { background: rgba(34,238,102,0.03); }
.tmux-badge {
  font-size: 10px; font-weight: 600;
  color: #3fb950;
  margin-left: 4px;
}
.tmux-actions {
  display: flex; justify-content: flex-end; gap: 2px;
  padding: 4px 6px;
  border-top: 1px solid var(--border, #23232a);
  background: rgba(0,0,0,0.15);
}
.foot-btn.danger:hover { color: #f44747; }

/* ── 编辑弹窗 ─────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0;
  z-index: 20000;
  background: rgba(0,0,0,0.5);
}
.modal-dialog {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20001;
  width: 360px; max-width: calc(100vw - 32px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #23232a);
  font-size: 14px; font-weight: 600; color: var(--text, #c8c8d0);
}
.modal-close {
  background: transparent; border: none;
  color: var(--text-dim, #6b6b78);
  cursor: pointer; font-size: 16px;
}
.modal-close:hover { color: #f44747; }
.modal-body {
  padding: 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border, #23232a);
}
.btn-cancel {
  padding: 8px 16px;
  border: 1px solid var(--border, #23232a);
  border-radius: 4px;
  background: transparent;
  color: var(--text-dim, #6b6b78);
  cursor: pointer; font-size: 13px;
}
.btn-cancel:hover { color: var(--text, #c8c8d0); }
.btn-save {
  padding: 8px 20px;
  border: none; border-radius: 4px;
  background: var(--glow, #22ee66);
  color: #09090b; cursor: pointer; font-size: 13px; font-weight: 600;
}
.btn-save:hover { opacity: 0.85; }
.btn-danger {
  padding: 8px 16px;
  border: 1px solid rgba(255,68,68,0.3);
  border-radius: 4px;
  background: transparent;
  color: #f44747;
  cursor: pointer; font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.btn-danger:hover { background: rgba(255,68,68,0.1); border-color: #f44747; }
.foot-gap { flex: 1; }

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
.cmd-preview {
  font-size: 11px; color: var(--text-dim, #6b6b78);
  font-family: var(--font, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 活跃终端 / 最小化列表 ────────────────────────────── */
.divider {
  height: 1px; background: var(--border, #23232a);
  margin: 4px 0;
}
.session-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
  color: var(--text, #c8c8d0);
  cursor: pointer; text-align: left;
  transition: border-color 0.2s;
}
.session-item:hover {
  border-color: var(--glow, #22ee66);
}
.session-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: #3fb950;
}
.session-label { flex: 1; font-size: 13px; }
.session-close {
  background: transparent; border: none; color: var(--text-dim, #6b6b78);
  cursor: pointer; font-size: 12px; padding: 2px;
  opacity: 0;
  transition: opacity 0.2s;
}
.session-item:hover .session-close { opacity: 1; }
.session-close:hover { color: #f44747; }

/* ── 底部固定按钮 ─────────────────────────────────────── */
.drawer-footer {
  position: sticky; bottom: 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--border, #23232a);
  margin-top: auto;
}
.launch-btn {
  width: 100%;
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
</style>
