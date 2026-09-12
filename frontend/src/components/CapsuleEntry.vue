<script setup lang="ts">
// ── 时空胶囊入口(右上工具组)───────────────────────────
//   ⏳ 触发按钮(未读点 + SSE 连接状态)+ 下拉列表。
//   行 = 文件名 + [并入](复制提示词)+ [✕ 删除](确认后挪临时目录,
//   找回问 AI:ls ~/.code-panel-capsules/.trash/)。
//   面板打开即拉一次列表(list 为权威,SSE 只做推送)并清未读。

import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { apiJson } from '@/utils/api-fetch'
import { useAuthStore } from '@/stores/auth'
import { useCapsuleStore } from '@/stores/capsule'
import { brainstormPrompt, wikiPrompt } from '@/utils/clipboard'
import { useCopyFeedback } from '@/composables/useCopyFeedback'
import { fmtRelTime } from '@/utils/format'

const router = useRouter()
const capsule = useCapsuleStore()
const auth = useAuthStore()

// ── 复制(时空胶囊命令前缀 / 行内并入 wiki 提示词)──────
const { copied: copiedCmd, copy: copyCmd } = useCopyFeedback(2000)
const { copy: copyMerge } = useCopyFeedback(2000)
/** 并入按钮的 ✓ 反馈按条目标识(复制哪条哪条亮) */
const mergedId = ref('')

/** 无参包装:直接绑 @click 防止把 MouseEvent 当文本传入 */
async function copyBrainstorm(): Promise<void> {
  await copyCmd(brainstormPrompt())
}

async function onMerge(id: string): Promise<void> {
  if (await copyMerge(wikiPrompt(id))) {
    mergedId.value = id
    setTimeout(() => { if (mergedId.value === id) mergedId.value = '' }, 2000)
  }
}

// ── 删除(确认 → 挪临时目录;UI 不再有回收站,找回问 AI)──
async function onRemove(id: string): Promise<void> {
  if (!confirm(`确定删除「${id}」?`)) return
  try {
    await apiJson('/api/capsule/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    capsule.refresh()
  } catch (e: unknown) {
    alert(`删除失败:${(e as Error).message}`)
  }
}

/** 清空全部胶囊(确认 → 逐条挪临时目录) */
async function onClearAll(): Promise<void> {
  const n = capsule.entries.length
  if (!n) return
  if (!confirm(`确定清空全部 ${n} 个胶囊?`)) return
  try {
    await apiJson('/api/capsule/clear', { method: 'POST' })
    capsule.refresh()
  } catch (e: unknown) {
    alert(`清空失败:${(e as Error).message}`)
  }
}

// ── 面板开合(照 EnvSwitcher 浮层惯例)──────────────────
const open = ref(false)
const triggerEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    capsule.refresh()
    capsule.clearUnread()
    nextTick(() => positionPanel())
  }
}
function close(): void { open.value = false }

function positionPanel(): void {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 420
  const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
  panelStyle.value = { top: `${r.bottom + 6}px`, left: `${left}px` }
}

function onDocMouseDown(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as Node
  if (triggerEl.value?.contains(t) || panelEl.value?.contains(t)) return
  close()
}
onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

function fmtTime(ms: number): string {
  return fmtRelTime(ms)
}
</script>

<template>
  <div ref="triggerEl" class="cp-root">
    <button class="cp-trigger" :class="{ on: open }" title="时空胶囊:AI 生成的速记文档,新胶囊自动弹卡" @click="toggle">
      ⏳ 时空胶囊
      <span class="cp-conn" :class="{ off: !capsule.connected }" :title="capsule.connected ? '监听中' : '连接断开,重连中…'" />
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panelEl" class="cp-panel" :style="panelStyle" @click.stop>
        <div class="cp-head">
          <button class="cp-wiki" title="打开 Wiki 页(浏览归档文档)" @click="router.push('/wiki'); close()">📖 Wiki</button>
          <span class="cp-sp" />
          <button
            v-if="auth.isSuper && capsule.entries.length"
            class="cp-clear"
            title="清空全部胶囊(挪入临时目录,7 天内可问 AI 找回)"
            @click="onClearAll"
          >🗑 清空</button>
          <button
            class="cp-copy"
            :title="'复制命令前缀,粘到终端后自己补主题:' + brainstormPrompt() + '<主题>'"
            @click="copyBrainstorm"
          >{{ copiedCmd ? '✓ 已复制' : '⧉ 提示词' }}</button>
        </div>

        <div class="cp-body">
          <div v-if="!capsule.entries.length" class="cp-hint">
            还没有胶囊 —— 在终端对 claude code 说<br>
            <code>/code-panel 时空胶囊 &lt;主题&gt;</code><br>
            新胶囊会自动弹到这里
          </div>
          <div
            v-for="e in capsule.entries" :key="e.id"
            class="cp-item"
            @click="capsule.openPreview(e.id)"
          >
            <span class="cp-kind">{{ e.kind === 'dir' ? '📁' : '📄' }}</span>
            <span class="cp-name" :title="e.id">{{ e.id }}</span>
            <span class="cp-meta">{{ fmtTime(e.mtime) }}</span>
            <button class="cp-merge" title="复制提示词,粘到终端交给 claude code 归档进 wiki" @click.stop="onMerge(e.id)">
              {{ mergedId === e.id ? '✓' : '并入' }}
            </button>
            <button v-if="auth.isSuper" class="cp-del" title="删除" @click.stop="onRemove(e.id)">✕</button>
          </div>
        </div>

        <div class="cp-foot">{{ capsule.dir || '~/.code-panel-capsules' }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cp-root { display: inline-flex; }
.cp-trigger {
  position: relative;
  font-family: var(--font); font-size: 10px;
  height: 26px; padding: 0 12px; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 5px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s; white-space: nowrap;
}
.cp-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.cp-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }
.cp-conn {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--glow, #22ee66);
}
.cp-conn.off { background: var(--text-dim, #6b6b78); }

.cp-panel {
  position: fixed; z-index: 12001;
  width: 420px; max-width: calc(100vw - 16px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45);
  display: flex; flex-direction: column; overflow: hidden;
}
.cp-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.cp-sp { flex: 1; }
.cp-wiki, .cp-copy, .cp-clear {
  font-size: 11px; padding: 2px 8px; cursor: pointer;
  color: var(--text-dim); background: transparent;
  border: 1px solid var(--border); border-radius: 4px;
}
.cp-wiki:hover { color: var(--glow); border-color: var(--glow-dim); }
.cp-clear:hover { color: #f44747; border-color: rgba(244,71,71,0.5); }
/* 复制=主操作:绿色实底,粘到终端补主题即触发时空胶囊 */
.cp-copy {
  color: #09090b; background: var(--glow, #22ee66);
  border-color: transparent; font-weight: 600;
}
.cp-copy:hover { filter: brightness(1.1); }

.cp-body { flex: 1; overflow-y: auto; max-height: min(48vh, 400px); padding: 6px; }
.cp-body::-webkit-scrollbar { width: 5px; }
.cp-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
.cp-hint { color: var(--text-dim); font-size: 11px; text-align: center; padding: 26px 10px; line-height: 2; }
.cp-hint code { background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 3px; padding: 0 5px; color: var(--glow); font-size: 10px; }
.cp-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 6px; cursor: pointer;
  transition: background 0.12s;
}
.cp-item:hover { background: rgba(34,238,102,0.05); }
.cp-kind { font-size: 12px; flex-shrink: 0; }
.cp-name {
  flex: 1; min-width: 0;
  font-family: var(--font, monospace); font-size: 11px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-meta { font-size: 10px; color: var(--text-dim); flex-shrink: 0; }
/* 并入:行尾小绿按钮;✕ 删除:hover 浮现 */
.cp-merge {
  flex-shrink: 0;
  font-size: 10px; padding: 2px 8px; cursor: pointer;
  color: var(--text-dim); background: transparent;
  border: 1px solid var(--border); border-radius: 8px;
  transition: color 0.12s, border-color 0.12s;
}
.cp-item:hover .cp-merge { color: var(--glow); border-color: var(--glow-dim); }
.cp-merge:hover { color: #09090b !important; background: var(--glow, #22ee66); border-color: transparent; }
.cp-del {
  flex-shrink: 0;
  border: none; background: transparent;
  color: var(--text-dim); font-size: 11px;
  width: 20px; height: 20px; border-radius: 4px;
  cursor: pointer; opacity: 0;
  transition: opacity 0.12s;
}
.cp-item:hover .cp-del { opacity: 1; }
.cp-del:hover { color: #f44747; background: rgba(244,71,71,0.12); }
.cp-foot {
  padding: 4px 12px 7px; border-top: 1px solid var(--border);
  font-family: var(--font, monospace); font-size: 9px;
  color: var(--text-dim); opacity: 0.7;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
