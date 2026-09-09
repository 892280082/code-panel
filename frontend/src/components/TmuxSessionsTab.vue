<script setup lang="ts">
// ── 「会话」Tab:Tmux 持久化终端管理(从 CommandDrawer 拆出)──────
//   列表 / 新建表单 / 点击已开窗口恢复 / 断开(仅关窗口) / 彻底删除(kill session)。
//   数据自治:直接用 projects / terminal store 拉取与操作(props 最少化),
//   自带 5s 轮询、与抽屉开合 / 项目切换同步(拆分前由父组件统一轮询,现各管各的)。
//   新建表单展开态由父组件持有 —— 底部「＋ 新建 Tmux」按钮的文案与高亮也依赖它;
//   创建成功后 emit update:showForm(false) 让父组件收起表单。

import { apiFetch } from '@/utils/api-fetch'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useTerminalStore } from '@/stores/terminal'

const props = defineProps<{ showForm: boolean }>()
const emit = defineEmits<{ (e: 'update:showForm', v: boolean): void }>()

const terminal = useTerminalStore()
const projects = useProjectsStore()

const tmuxSessions = ref<any[]>([])
const newTmuxName = ref('')
const newTmuxDesc = ref('')
const tmuxError = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

// 表单展开瞬间清空上次输入(拆分前 onNewTmux 只清 name/desc,错误提示保留到下次提交)
watch(() => props.showForm, (open) => {
  if (open) { newTmuxName.value = ''; newTmuxDesc.value = '' }
})

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
    emit('update:showForm', false)
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
  loadTmuxSessions()
  pollTimer = setInterval(loadTmuxSessions, 5000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// 项目切换时清空并重拉(命令列表由父组件另行处理)
watch(() => projects.currentId, () => {
  tmuxSessions.value = []
  if (terminal.drawerOpen) loadTmuxSessions()
})

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

/* ── 空态提示 ─────────────────────────────────────────── */
.section-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 12px; text-align: center; padding: 16px 0;
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
.foot-btn.danger:hover { color: #f44747; }
</style>
