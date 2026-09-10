<script setup lang="ts">
// ── 模型供应商切换器(右上角)────────────────────────────
//   只列「已启用」的供应商;点「使用」= 全局切换(active-llm.sh + shell rc +
//   ~/.claude/settings.json 受管键同步),新开终端 claude 即用。
//   管理入口跳 ⚙ 配置 → 模型(useUiStore 跨组件打开)。

import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useLlmStore } from '@/stores/llm'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'

const llm = useLlmStore()
const ui = useUiStore()
const auth = useAuthStore()

const open = ref(false)
const busyId = ref('')           // '':无;'<id>':切换中;'none':切「不注入」中
const note = ref('')
const triggerEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

async function pick(id: string) {
  busyId.value = id
  note.value = ''
  try {
    await llm.activate(id)
    note.value = `✅ 已启用「${llm.activeName}」→ 新开终端生效`
  } catch (e: unknown) { note.value = (e as Error).message }
  finally { busyId.value = '' }
}

async function pickNone() {
  busyId.value = 'none'
  note.value = ''
  try {
    await llm.activate(null)
    note.value = '↩ 已停用注入 → claude 走官方登录态'
  } catch (e: unknown) { note.value = (e as Error).message }
  finally { busyId.value = '' }
}

function openManage() {
  open.value = false
  ui.openConfig('llm')
}

function toggle() { open.value = !open.value; if (open.value) { note.value = ''; nextTick(() => positionPanel()) } }
function close() { open.value = false }

function positionPanel() {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 400
  const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
  panelStyle.value = { top: `${r.bottom + 6}px`, left: `${left}px` }
}

function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerEl.value?.contains(t) || panelEl.value?.contains(t)) return
  close()
}
onMounted(() => { llm.load().catch(() => {}); document.addEventListener('mousedown', onDocMouseDown) })
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))
</script>

<template>
  <div ref="triggerEl" class="pv-root">
    <button class="pv-trigger" :class="{ on: open || !!llm.activeId }" title="模型供应商(切换后新开终端 claude 即用)" @click="toggle">
      模型<template v-if="llm.activeName">·{{ llm.activeName }}</template><template v-else-if="!llm.loaded">…</template>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panelEl" class="pv-panel" :style="panelStyle" @click.stop>
        <div class="pv-head">
          <span class="pv-title">模型供应商</span>
          <span class="pv-head-sp" />
          <button v-if="auth.isSuper" class="pv-manage" title="管理供应商(增删改/启用)" @click="openManage">⚙ 管理</button>
          <button class="pv-close" title="关闭" @click="close">✕</button>
        </div>

        <!-- 只列已启用的供应商 -->
        <div class="pv-list">
          <div v-if="!llm.enabledProviders.length" class="pv-hint">
            还没有启用的供应商<br />点右上「⚙ 管理」添加(DeepSeek / GLM / Kimi 模板一键预填)
          </div>
          <div
            v-for="p in llm.enabledProviders" :key="p.id"
            class="pv-row" :class="{ cur: p.id === llm.activeId }"
          >
            <div class="pv-row-main">
              <span class="pv-dot" />
              <span class="pv-name" :title="p.name">{{ p.name }}</span>
              <span class="pv-base" :title="p.baseUrl">{{ p.baseUrl }}</span>
            </div>
            <button
              v-if="p.id === llm.activeId" class="pv-used" disabled>✓ 生效中</button>
            <button v-else-if="auth.isSuper" class="pv-use" :disabled="busyId === p.id" @click="pick(p.id)">
              {{ busyId === p.id ? '切换中…' : '使用' }}
            </button>
          </div>
        </div>

        <div class="pv-foot">
          <span class="pv-note">{{ note }}</span>
          <span class="pv-foot-sp" />
          <button
            v-if="llm.activeId && auth.isSuper" class="pv-none" :disabled="busyId === 'none'"
            title="停用注入,恢复 claude 官方登录态" @click="pickNone">
            {{ busyId === 'none' ? '处理中…' : '↩ 不注入' }}
          </button>
        </div>
        <div class="pv-path">
          {{ llm.envFile || '~/.code-panel/active-llm.sh' }} · rc {{ llm.rcMounted ? '已挂' : '未挂' }}
          <template v-if="llm.foreignKeys.length"> · ⚠ settings.json 有外部 ANTHROPIC 配置</template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pv-root { display: inline-flex; }
.pv-trigger {
  font-family: var(--font); font-size: 10px;
  height: 26px; padding: 0 12px; box-sizing: border-box;
  display: inline-flex; align-items: center;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s; white-space: nowrap;
}
.pv-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.pv-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

.pv-panel {
  position: fixed; z-index: 12001;
  width: 400px; max-width: calc(100vw - 16px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45);
  display: flex; flex-direction: column; overflow: hidden;
}
.pv-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.pv-head-sp { flex: 1; }
.pv-title { font-size: 12px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-manage { font-family: var(--font); font-size: 10px; padding: 2px 8px; cursor: pointer; color: var(--text-dim); background: transparent; border: 1px solid var(--border); border-radius: 8px; }
.pv-manage:hover { color: var(--glow); border-color: var(--glow-dim); }
.pv-close { background: transparent; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
.pv-close:hover { color: var(--danger, #f44747); background: rgba(244,71,71,0.1); }

.pv-list { display: flex; flex-direction: column; padding: 6px 8px; max-height: min(42vh, 340px); overflow-y: auto; }
.pv-hint { color: var(--text-dim); font-size: 11px; text-align: center; padding: 20px 10px; line-height: 1.8; }
.pv-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px; border: 1px solid transparent;
}
.pv-row:hover { background: rgba(255,255,255,0.03); }
.pv-row.cur { border-color: var(--glow-dim); background: rgba(34,238,102,0.05); }
.pv-row-main { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pv-dot { display: none; }
.pv-row.cur .pv-dot { display: inline-block; }
.pv-name { font-size: 12px; color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-row.cur .pv-name { color: var(--glow); }
.pv-base { font-family: var(--font); font-size: 10px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pv-use { font-family: var(--font); font-size: 11px; padding: 4px 14px; cursor: pointer; color: #060; background: var(--glow); border: none; border-radius: 12px; flex-shrink: 0; }
.pv-use:hover { filter: brightness(1.1); }
.pv-use:disabled { opacity: 0.5; cursor: wait; }
.pv-used { font-family: var(--font); font-size: 10px; padding: 4px 12px; color: var(--glow); background: transparent; border: 1px solid var(--glow-dim); border-radius: 12px; flex-shrink: 0; }
.pv-none { font-family: var(--font); font-size: 10px; padding: 3px 10px; cursor: pointer; color: var(--text-dim); background: transparent; border: 1px solid var(--border); border-radius: 10px; }
.pv-none:hover { color: var(--danger, #f44747); border-color: var(--danger, #f44747); }
.pv-none:disabled { opacity: 0.5; cursor: wait; }

.pv-foot { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-top: 1px solid var(--border); flex-shrink: 0; }
.pv-note { font-size: 10px; color: var(--glow); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-foot-sp { flex: 1; }
.pv-path { padding: 3px 12px 7px; font-family: var(--font, monospace); font-size: 9px; color: var(--text-dim); opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
