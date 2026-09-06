<script setup lang="ts">
// ── 环境变量 / Env Switcher(右上第 3 图标,Tab 式)─────────────
//   数据 = 项目 .code-panel/envs.yaml 的 groups;Tab 展示;点「选用」= 全量重写全局 active-env.sh。
//   项目没设过 → 自动落默认组(source=default),零配置也能起。

import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { apiJson } from '@/utils/api-fetch'
import { useProjectsStore } from '@/stores/projects'

interface EnvGroup { id: string; name: string; default?: boolean; vars: Record<string, string> }
interface EnvCurrent { groupId: string; name: string; source: 'user' | 'default'; vars: Record<string, string> }

const projects = useProjectsStore()

const open = ref(false)
const loading = ref(false)
const busyId = ref('')
const groups = ref<EnvGroup[]>([])
const current = ref<EnvCurrent | null>(null)
const viewId = ref('')            // 当前查看的 Tab
const varsUsed = ref(0)
const rcMounted = ref(false)
const envFile = ref('')
const note = ref('')
const triggerEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

const viewGroup = computed<EnvGroup | null>(() => groups.value.find(g => g.id === viewId.value) || groups.value[0] || null)
const viewVars = computed<[string, string][]>(() => Object.entries(viewGroup.value?.vars || {}))

function applySnapshot(s: any) {
  groups.value = Array.isArray(s?.groups) ? s.groups : []
  current.value = s?.current || null
  varsUsed.value = s?.varsUsed || 0
  rcMounted.value = !!s?.rcMounted
  envFile.value = s?.envFile || ''
  if (!groups.value.some(g => g.id === viewId.value)) {
    viewId.value = current.value?.groupId || groups.value[0]?.id || ''
  }
}

async function ensure() {
  if (!projects.currentId) { groups.value = []; current.value = null; return }
  loading.value = true
  try {
    const res = await apiJson(`/api/env/ensure?project=${encodeURIComponent(projects.currentId)}`, { method: 'POST' })
    applySnapshot(res.data?.snapshot)
  } catch (e: unknown) { note.value = (e as Error).message }
  finally { loading.value = false }
}

async function pick(g: EnvGroup) {
  if (!projects.currentId) return
  busyId.value = g.id
  note.value = ''
  viewId.value = g.id
  try {
    const res = await apiJson(`/api/env/activate?project=${encodeURIComponent(projects.currentId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: g.id }),
    })
    applySnapshot(res.data)
    note.value = `✅ 已选用「${g.name || g.id}」→ 新开终端生效`
  } catch (e: unknown) { note.value = (e as Error).message }
  finally { busyId.value = '' }
}

async function reset() {
  if (!projects.currentId) return
  note.value = ''
  try {
    const res = await apiJson(`/api/env/reset?project=${encodeURIComponent(projects.currentId)}`, { method: 'POST' })
    applySnapshot(res.data)
    note.value = '↩ 已恢复为默认环境组'
  } catch (e: unknown) { note.value = (e as Error).message }
}

function toggle() { open.value = !open.value; if (open.value) nextTick(() => positionPanel()) }
function close() { open.value = false }

function positionPanel() {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 440
  const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
  panelStyle.value = { top: `${r.bottom + 6}px`, left: `${left}px` }
}

watch(() => projects.currentId, () => { if (projects.currentId) ensure() })
function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerEl.value?.contains(t) || panelEl.value?.contains(t)) return
  close()
}
onMounted(() => { ensure(); document.addEventListener('mousedown', onDocMouseDown) })
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))
</script>

<template>
  <div ref="triggerEl" class="en-root">
    <button class="en-trigger" :class="{ on: open }" :title="'环境变量(项目 .code-panel/envs.yaml)'" @click="toggle">
      🅰 环境<template v-if="current">·{{ current.name }}</template><template v-else-if="loading">…</template>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panelEl" class="en-panel" :style="panelStyle" @click.stop>
        <!-- 头 -->
        <div class="en-head">
          <span class="en-title">环境变量<template v-if="projects.currentProject"> · {{ projects.currentProject.name }}</template></span>
          <button class="en-close" title="关闭" @click="close">✕</button>
        </div>

        <!-- 概要一行:生效组 + 计数 + 恢复默认 -->
        <div class="en-statbar">
          <span v-if="current" class="en-cur">
            生效:<b>{{ current.name }}</b>
            <em :class="current.source === 'default' ? 'def' : 'usr'">{{ current.source === 'default' ? '默认' : '已选用' }}</em>
          </span>
          <span v-else class="en-cur muted">未配置(无默认组)</span>
          <span class="en-stat"><code>CODE_PANEL_*</code> × {{ varsUsed }}</span>
          <button v-if="current && current.source === 'user'" class="en-reset" title="清除手动选择,回落到默认组" @click="reset">↩ 默认</button>
        </div>

        <!-- 分组 Tabs -->
        <div class="en-tabs">
          <button
            v-for="g in groups" :key="g.id"
            class="en-tab" :class="{ on: viewId === g.id }" :title="g.id"
            @click="viewId = g.id"
          >
            {{ g.name || g.id }}
            <span v-if="current && current.groupId === g.id" class="en-cur-ico">●</span>
            <span v-else-if="g.default" class="en-def-ico">◇</span>
          </button>
        </div>

        <!-- 内容 = 当前查看组 -->
        <div class="en-body">
          <div v-if="!groups.length" class="en-hint">
            在项目 <code>.code-panel/envs.yaml</code> 配置环境组(注释即示例)
          </div>
          <div v-else-if="!viewVars.length" class="en-hint muted">「{{ viewGroup?.name }}」为空组,无变量</div>
          <div v-else class="en-vars">
            <div v-for="([k, v], i) in viewVars" :key="i" class="en-var"><code>{{ k }}</code> = <span>{{ v }}</span></div>
          </div>
        </div>

        <!-- 底部:选用 / 生效提示 -->
        <div class="en-foot">
          <span class="en-foot-note">{{ note }}</span>
          <span class="en-foot-sp" />
          <button
            v-if="viewGroup && current && current.groupId === viewGroup.id"
            class="en-used" disabled>✓ 生效中</button>
          <button v-else-if="viewGroup" class="en-use" :disabled="busyId === viewGroup.id" @click="pick(viewGroup)">
            {{ busyId === viewGroup.id ? '选用中…' : '选用此组' }}
          </button>
        </div>
        <div class="en-path">{{ envFile || '~/.code-panel/active-env.sh' }} · rc {{ rcMounted ? '已挂' : '未挂' }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.en-root { display: inline-flex; }
.en-trigger {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s; white-space: nowrap;
}
.en-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.en-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

.en-panel {
  position: fixed; z-index: 12001;
  width: 440px; max-width: calc(100vw - 16px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45);
  display: flex; flex-direction: column; overflow: hidden;
}
.en-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.en-title { font-size: 12px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.en-close { background: transparent; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
.en-close:hover { color: var(--danger, #f44747); background: rgba(244,71,71,0.1); }

.en-statbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.12); flex-shrink: 0; font-size: 10px; }
.en-cur b { color: var(--glow); }
.en-cur em { font-style: normal; margin-left: 5px; padding: 1px 6px; border-radius: 8px; font-size: 9px; }
.en-cur em.usr { color: var(--glow); border: 1px solid var(--glow-dim); }
.en-cur em.def { color: var(--text-dim); border: 1px solid var(--border); }
.en-cur.muted, .muted { color: var(--text-dim); }
.en-stat { color: var(--text-dim); margin-left: auto; }
.en-stat code { color: var(--text); }
.en-reset { font-family: var(--font); font-size: 9px; padding: 2px 8px; cursor: pointer; color: var(--text-dim); background: transparent; border: 1px solid var(--border); border-radius: 8px; }
.en-reset:hover { color: var(--danger, #f44747); border-color: var(--danger, #f44747); }

/* 分组 Tabs */
.en-tabs { display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--border); flex-shrink: 0; overflow-x: auto; }
.en-tab { padding: 6px 14px; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--text-dim); font-size: 12px; cursor: pointer; white-space: nowrap; transition: color 0.15s, border-color 0.15s; }
.en-tab:hover { color: var(--text); }
.en-tab.on { color: var(--glow); border-bottom-color: var(--glow); }
.en-cur-ico { color: var(--glow); margin-left: 4px; }
.en-def-ico { color: var(--text-dim); margin-left: 4px; font-size: 10px; }

.en-body { flex: 1; overflow-y: auto; max-height: min(40vh, 320px); padding: 8px 12px 10px; }
.en-body::-webkit-scrollbar { width: 5px; }
.en-body::-webkit-scrollbar-track { background: transparent; }
.en-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.en-hint { color: var(--text-dim); font-size: 11px; text-align: center; padding: 22px 10px; line-height: 1.8; }
.en-hint code { background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 3px; padding: 0 4px; color: var(--text); }

.en-vars { display: flex; flex-direction: column; gap: 3px; }
.en-var { font-family: var(--font, monospace); font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.en-var code { color: var(--glow); }

.en-foot { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-top: 1px solid var(--border); flex-shrink: 0; }
.en-foot-note { font-size: 10px; color: var(--glow); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.en-foot-sp { flex: 1; }
.en-use { font-family: var(--font); font-size: 11px; padding: 4px 16px; cursor: pointer; color: #060; background: var(--glow); border: none; border-radius: 12px; }
.en-use:hover { filter: brightness(1.1); }
.en-use:disabled { opacity: 0.5; cursor: wait; }
.en-used { font-family: var(--font); font-size: 10px; padding: 4px 12px; color: var(--glow); background: transparent; border: 1px solid var(--glow-dim); border-radius: 12px; }

.en-path { padding: 3px 12px 7px; font-family: var(--font, monospace); font-size: 9px; color: var(--text-dim); opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
