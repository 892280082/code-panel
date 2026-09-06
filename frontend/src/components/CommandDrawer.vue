<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'
import { useRepoBrowserStore } from '@/stores/repo-browser'
import { useCloudStore } from '@/stores/cloud'

const terminal = useTerminalStore()
const projects = useProjectsStore()
const browser = useRepoBrowserStore()
const cloud = useCloudStore()
const router = useRouter()
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

// ── 按钮拖拽 + 左右芯片簇 ───────────────────────────────
//   FAB 底边定位(right/top 锚定)，默认右下角。左侧排 1..N 终端芯片，
//   右侧贴 📂 仓库芯片 —— 拖 FAB 时三者联动、位置一起持久化。
const POS_KEY = 'cmd-drawer-trigger-pos'
const BTN_SIZE = 44          // FAB 直径
const CHIP_SIZE = 35         // 左右小圆片直径
const GAP = 16               // FAB 与芯片间距
const EDGE = 16              // 芯片簇最外侧距视口右/下边缘的距离
/** FAB 距右边缘的最小值：保证右侧 📂 仓库 + ☁ 云 两个芯片始终留在可视区内 */
const MIN_FAB_RIGHT = EDGE + 2 * (CHIP_SIZE + GAP)

/** 屏幕分辨率变化后，上次记录的位置可能超出可视区域，越界则重置回屏幕内，避免图标丢失 */
function clampBtnPos(v: { x: number; y: number } | null) {
  if (!v) return null
  const maxX = window.innerWidth - BTN_SIZE - EDGE
  const maxY = window.innerHeight - BTN_SIZE - EDGE
  if (maxX < MIN_FAB_RIGHT || maxY < EDGE) return null
  return { x: Math.min(Math.max(v.x, MIN_FAB_RIGHT), maxX), y: Math.min(Math.max(v.y, EDGE), maxY) }
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
// 默认：右下角 —— 右侧仓库芯片贴边 16px，FAB 再靠左 51px，底部贴边 16px
const btnX = ref(clamped?.x ?? MIN_FAB_RIGHT)
const btnY = ref(clamped?.y ?? Math.max(EDGE, window.innerHeight - BTN_SIZE - EDGE))
// 上次记录已越界 → 用修正后的位置覆盖存储，下次打开直接是正常位置
if (raw && clamped && (raw.x !== clamped.x || raw.y !== clamped.y)) {
  localStorage.setItem(POS_KEY, JSON.stringify(clamped))
}
let dragging = false
let moved = false            // 拖动超过阈值才算拖拽，否则是普通点击
let dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0

/** 当前项目 id */
const currentProject = computed(() => projects.currentProject)
/** 当前项目显示名称(自定义 Tab 标题) */
const groupLabel = computed(() => projects.currentProject?.name || '自定义')

// ── 芯片几何：与 FAB 位置联动 ───────────────────────────
/** 浮动终端数字条只列 tmux 常驻会话(Apps 启停一次性会话 / 手动 cmd 终端不占 1/2/3) */
const sessionList = computed(() =>
  Array.from(terminal.sessions.entries()).filter(([, s]) => s.kind === 'tmux'),
)
/** 左侧终端芯片条右缘 = FAB 右缘 + FAB 宽 + 间距 */
const chipsBarRight = computed(() => btnX.value + BTN_SIZE + GAP)
/** 右侧仓库芯片右缘 = FAB 右缘 − 芯片宽 − 间距 */
const repoChipRight = computed(() => btnX.value - CHIP_SIZE - GAP)
/** 最外侧 ☁ 云芯片右缘 = FAB 右缘 − 2×(芯片宽+间距) */
const cloudChipRight = computed(() => btnX.value - 2 * (CHIP_SIZE + GAP))

function onTriggerDragStart(e: MouseEvent) {
  if (terminal.drawerOpen) return
  dragging = true
  moved = false
  dragStartX = e.clientX; dragStartY = e.clientY
  dragOrigX = btnX.value; dragOrigY = btnY.value
  document.addEventListener('mousemove', onTriggerDragMove)
  document.addEventListener('mouseup', onTriggerDragEnd)
}
function onTriggerDragMove(e: MouseEvent) {
  if (!dragging) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return  // 3px 内视为点击
  moved = true
  e.preventDefault()
  btnX.value = dragOrigX - dx
  btnY.value = dragOrigY + dy
}
function onTriggerDragEnd() {
  if (!dragging) return
  dragging = false
  const c = clampBtnPos({ x: btnX.value, y: btnY.value })
  if (c) { btnX.value = c.x; btnY.value = c.y }
  localStorage.setItem(POS_KEY, JSON.stringify({ x: btnX.value, y: btnY.value }))
  document.removeEventListener('mousemove', onTriggerDragMove)
  document.removeEventListener('mouseup', onTriggerDragEnd)
}
/** FAB 点击：拖拽过(>3px)则忽略，防止拖完误开抽屉 */
function onTriggerClick() {
  if (moved) { moved = false; return }
  terminal.toggleDrawer()
}

// ── 终端芯片点击：最小化 → 恢复+置顶；活跃 → 置顶 ──────
function onChipClick(port: number) {
  const s = terminal.sessions.get(port)
  if (!s) return
  if (s.minimized) terminal.restoreSession(port)
  else terminal.bringToFront(port)
}

// ── ☁ 云芯片：开云文件抽屉(同时收起命令抽屉) ────────────
function onCloudChipClick() {
  if (terminal.drawerOpen) terminal.closeDrawer()
  cloud.toggle()
}

// ── 📂 仓库芯片：未开 → 打开当前项目第一个仓库；已开 → 最小化则恢复，否则关闭 ──
const repoChipTitle = computed(() => {
  if (!browser.visible) return browser.repoId ? `打开：${browser.repoName}` : '去 Git 页面选择仓库'
  return browser.minimized ? '恢复：Repo Browser' : '关闭：Repo Browser'
})

async function onRepoChipClick() {
  if (browser.visible) {
    if (browser.minimized) browser.restore()
    else browser.closeModal()
    return
  }
  if (!projects.currentId) { router.push('/git'); return }
  try {
    const res = await apiFetch(`/api/git/repos?project=${encodeURIComponent(projects.currentId)}`)
    const data = await res.json()
    const repos = (data?.ok ? data.data : []) || []
    if (repos.length) browser.openModal(repos[0].id, repos[0].name, repos[0].path)
    else router.push('/git')
  } catch {
    router.push('/git')
  }
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

/** 底部「＋ 新建 Tmux」:切到会话 Tab 并展开表单(再点收起) */
function onNewTmux() {
  activeTab.value = 'tmux'
  showNewTmux.value = !showNewTmux.value
  if (showNewTmux.value) { newTmuxName.value = ''; newTmuxDesc.value = '' }
}

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

          <!-- 会话 Tab(Tmux 持久化终端) -->
          <template v-if="activeTab === 'tmux'">
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
