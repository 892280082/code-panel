<script setup lang="ts">
// ── 「会话」Tab:Tmux 持久化终端管理(从 CommandDrawer 拆出)──────
//   全局平铺(2026-09-11 用户定:不按当前项目过滤 —— 会话里跑着 claude ≈500MB,
//   藏在别的项目后面看不见但一直吃内存;全部列出,按项目分盒)。
//   可见性后端收口:超管见宿主全部;普通用户仅见被分配项目(user_projects)的会话。
//   列表 / 新建表单 / 点击已开窗口恢复 / 断开(仅关窗口) / 彻底删除(kill session)。
//   数据自治:直接用 projects / terminal store 拉取与操作(props 最少化),
//   自带 5s 轮询、与抽屉开合同步。新建表单展开态由父组件持有 ——
//   底部「＋ 新建 Tmux」按钮的文案与高亮也依赖它;创建成功后 emit 收起表单。

import { apiJson, errText } from '@/utils/api-fetch'
import { fmtTime } from '@/utils/format'
import type { TmuxSessionInfo } from '@/types'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'

const props = defineProps<{ showForm: boolean }>()
const emit = defineEmits<{ (e: 'update:showForm', v: boolean): void }>()

const terminal = useTerminalStore()
const projects = useProjectsStore()

const tmuxSessions = ref<TmuxSessionInfo[]>([])
const newTmuxName = ref('')
const newTmuxDesc = ref('')
const tmuxError = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

// 表单展开瞬间:清名称,备注默认 = 当前项目名(归属一眼可见,可改)
watch(() => props.showForm, (open) => {
  if (open) {
    newTmuxName.value = ''
    newTmuxDesc.value = projects.currentProject?.name || ''
  }
})

/** 拉取宿主全部 tmux 会话(不带 project = 全项目平铺;项目归属前端用 chip 展示) */
async function loadTmuxSessions() {
  try {
    const data = await apiJson<{ data: TmuxSessionInfo[] }>('/api/terminal/tmux/list')
    const list: TmuxSessionInfo[] = data.data || []
    tmuxSessions.value = list.slice().sort((a, b) => b.createdAt - a.createdAt)
  } catch { /* ignore */ }
}

/** 项目 id → 显示名(盒子标题;项目被删时退化为 #id) */
function projectName(id: string): string {
  return projects.projects.find(p => p.id === id)?.name || `#${id}`
}

/** 按项目分盒(项目视角 = 只看当前项目,🌐全局视角 = 全项目一屏;组序 = 各组最新会话时间倒序) */
const groupedTmux = computed(() => {
  const map = new Map<string, TmuxSessionInfo[]>()
  for (const s of tmuxSessions.value) {
    const key = s.project || ''   // null=未识别归属(后端已滤,防御兜底)
    // 项目视角只列当前项目的会话 —— 别的项目的不给点(点了也看不见窗口)
    if (!terminal.showAll && projects.currentId && key !== projects.currentId) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()]
    .map(([project, sessions]) => ({ project, sessions }))
    .sort((a, b) => (b.sessions[0]?.createdAt ?? 0) - (a.sessions[0]?.createdAt ?? 0))
})

/** 该 tmux 会话在当前视角是否已开窗口(有则返回端口,null=未连接)。
 *  只认可见窗口:项目视角下别的项目开着的窗口不算,点「连接」走正常 attach */
function attachedTmuxPort(fullName: string): number | null {
  for (const [port, s] of terminal.visibleEntries) {
    if (s.kind === 'tmux' && s.tmuxSession === fullName) return port
  }
  return null
}

/** 展示名(后端已去前缀,name 为空时退化为物理名) */
function prettyTmuxName(s: TmuxSessionInfo): string { return s.name || s.fullName }

async function onConnectTmux(s: TmuxSessionInfo) {
  const port = attachedTmuxPort(s.fullName)
  if (port !== null) { terminal.restoreSession(port); return }
  await terminal.attachTmux(s.fullName, prettyTmuxName(s), s.project || '', s.description || '')
}

async function handleCreateTmux() {
  tmuxError.value = ''
  if (!projects.currentId) { tmuxError.value = '无当前项目'; return }
  if (!newTmuxName.value.trim()) { tmuxError.value = '请输入会话名称'; return }
  // 备注留空则以添加当时的项目名兜底(归属一眼可见)
  const desc = newTmuxDesc.value.trim() || projects.currentProject?.name || ''
  try {
    const data = await apiJson<{ data: { name: string; fullName: string } }>('/api/terminal/tmux/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: projects.currentId,
        name: newTmuxName.value.trim(),
        description: desc || undefined,
      }),
    })
    const { name, fullName } = data.data
    newTmuxName.value = ''; newTmuxDesc.value = ''
    emit('update:showForm', false)
    loadTmuxSessions()
    await terminal.attachTmux(fullName, name, projects.currentId!, desc)
  } catch (e) {
    tmuxError.value = errText(e, '创建失败')
  }
}

/** 断开:只 detach 本会话已开窗口(tmux 会话保留) */
function onDetachTmux(s: TmuxSessionInfo) {
  const port = attachedTmuxPort(s.fullName)
  if (port !== null) terminal.closeSession(port)
}

/** 彻底删除:断开 + kill session + 清备注(按会话归属项目操作,与当前选中项目无关) */
function onDeleteTmux(s: TmuxSessionInfo) {
  if (!confirm(`确定删除 tmux 会话「${prettyTmuxName(s)}」?会话内的所有进程将被终止!`)) return
  terminal.deleteTmuxSession(s.fullName, s.project || '').then(loadTmuxSessions)
}

// ── 抓屏复制(mouse on 时网页拖选被 tmux 截获 → 后端 capture-pane 出纯文本)──
//   弹窗是全局组件 TmuxCaptureModal(终端窗口标题栏 ⧉ 与此处共用),
//   这里只负责把目标塞进 store。
function openCapture(s: TmuxSessionInfo) {
  if (!s.project) return
  terminal.openCapture({ fullName: s.fullName, label: prettyTmuxName(s), project: s.project })
}

/** 鼠标模式开关(会话级,不动全局 conf):
 *  关 → 网页里恢复原生拖选 + Cmd/Ctrl+C 复制(滚轮退化为方向键,滚动用 Ctrl+B [)
 *  开 → 恢复滚轮滚动(复制走「抓屏」弹窗) */
async function onToggleMouse(s: TmuxSessionInfo) {
  try {
    await apiJson('/api/terminal/tmux/mouse', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: s.project, name: s.fullName, enabled: !s.mouse }),
    })
    loadTmuxSessions()
  } catch { /* ignore */ }
}

function startPolling() {
  loadTmuxSessions()
  pollTimer = setInterval(loadTmuxSessions, 5000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// 列表 = 宿主全局平铺,与当前选中项目无关(项目切换不再清空重拉)

// 抽屉开 → 轮询;关 → 停
watch(() => terminal.drawerOpen, (open) => {
  if (open) startPolling()
  else stopPolling()
})

onMounted(() => { if (terminal.drawerOpen) startPolling() })
onUnmounted(stopPolling)
</script>

<template>
  <!-- 新建表单 -->
  <div v-if="showForm" class="form-card">
    <input v-model="newTmuxName" class="form-input mono" placeholder="会话名称" @keyup.enter="handleCreateTmux" />
    <input v-model="newTmuxDesc" class="form-input" placeholder="备注（可选）" @keyup.enter="handleCreateTmux" />
    <div v-if="tmuxError" class="form-error">{{ tmuxError }}</div>
    <button class="form-submit" @click="handleCreateTmux">创建并连接</button>
  </div>

  <div v-if="tmuxSessions.length === 0 && !showForm" class="section-hint">
    没有 tmux 会话。创建后终端会常驻服务器，刷新页面 / 重启服务后也能重连。<br>
    可见项目的会话一屏可见(按项目分盒)—— 别让跑着 claude 的会话藏着吃内存。
  </div>

  <!-- 按项目分盒:盒头 = 项目名,盒内 = 该项目具体会话(对齐 Apps 页 platform-card) -->
  <div v-for="g in groupedTmux" :key="g.project" class="platform-card">
    <h3 class="platform-name">🗂 {{ projectName(g.project) }}<span class="cnt">{{ g.sessions.length }}</span></h3>
    <div v-for="s in g.sessions" :key="s.fullName" class="tmux-item">
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
        <button
          v-if="s.project"
          class="foot-btn"
          :title="s.mouse
            ? '当前:滚轮可滚动,但网页里拖选/复制会被 tmux 截获。点击关闭后可拖选 + Cmd/Ctrl+C 复制(滚轮变方向键,滚动用 Ctrl+B [)'
            : '当前:网页里可拖选复制,滚轮是方向键。点击恢复滚轮滚动'"
          @click.stop="onToggleMouse(s)"
        >
          鼠标:{{ s.mouse ? '开' : '关' }}
        </button>
        <button v-if="s.project" class="foot-btn" title="抓取会话屏幕文本,弹窗里随意选/一键复制" @click.stop="openCapture(s)">
          复制
        </button>
        <button v-if="attachedTmuxPort(s.fullName) !== null" class="foot-btn" @click.stop="onDetachTmux(s)">
          断开
        </button>
        <button class="foot-btn danger" @click.stop="onDeleteTmux(s)">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 新建表单(与拆分前 CommandDrawer 同名同款,scoped 各自生效)── */
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
  color: var(--danger); font-size: 11px;
}
.form-submit {
  padding: 8px;
  border: none; border-radius: 4px;
  background: var(--glow, #22ee66);
  color: var(--bg); font-size: 13px; cursor: pointer;
  font-weight: 600;
  transition: opacity 0.2s;
}
.form-submit:hover { opacity: 0.85; }

/* ── 空态提示 ─────────────────────────────────────────── */
.section-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 12px; text-align: center; padding: 16px 0;
}

/* ── 项目分盒(样式对齐 Apps 页 platform-card:大框 + 左上角缺口放项目名)── */
.platform-card {
  position: relative;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border, #23232a);
  border-radius: 10px;
  background: var(--bg, #09090b);
  padding: 16px 10px 6px;
}
.platform-card + .platform-card { margin-top: 12px; }
.platform-name {
  position: absolute; top: -11px; left: 14px; margin: 0; z-index: 2;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-dim, #6b6b78);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 10px;
  padding: 2px 12px;
  white-space: nowrap;
  cursor: default;
}
.platform-name .cnt {
  font-size: 9px; color: var(--text-dim, #6b6b78);
  background: var(--bg, #09090b); border: 1px solid var(--border, #23232a);
  border-radius: 8px; padding: 0 5px; line-height: 14px;
}

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
.tmux-item:hover { border-color: rgba(var(--glow-rgb),0.3); }
.tmux-body {
  padding: 10px 12px 8px;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
}
.tmux-body:hover { background: rgba(var(--glow-rgb),0.03); }
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

/* ── 会话卡片文字 / 底部小按钮 ─────────────────────────── */
.cmd-label { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-preview {
  font-size: 11px; color: var(--text-dim, #6b6b78);
  font-family: var(--font, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
.foot-btn.danger:hover { color: var(--danger); }
</style>
