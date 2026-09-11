<script setup lang="ts">
// ── 胶囊预览弹窗(全局挂 App.vue)───────────────────────
//   只做预览:整块 iframe(单文件→暗色单页;目录→双栏自带文件树)。
//   并入 wiki 的操作在列表页行按钮上,这里不出现。

import { ref, computed, watch } from 'vue'
import { useCapsuleStore } from '@/stores/capsule'
import { useOverlayLayer } from '@/utils/z-layer'
import { copyText } from '@/utils/clipboard'

const capsule = useCapsuleStore()
const { zIndex, onRaise } = useOverlayLayer(() => capsule.previewId !== null)

const reloadKey = ref(0)

/** 复制「胶囊:文件名」(粘给 AI 一眼知道去 ~/.code-panel-capsules/ 找) */
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function onCopyName(): Promise<void> {
  if (!capsule.previewId) return
  if (!await copyText(`胶囊:${capsule.previewId}`)) return
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1500)
}

const entry = computed(() => capsule.entries.find(e => e.id === capsule.previewId) || null)

const frameSrc = computed<string>(() => {
  const id = capsule.previewId
  if (!id) return ''
  const e = entry.value
  const q = `id=${encodeURIComponent(id)}`
  return e?.kind === 'dir'
    ? `/api/capsule/view?${q}`
    : `/api/capsule/content?${q}`
})

// 切换胶囊时重挂 iframe(清掉上一个的页面)
watch(() => capsule.previewId, () => { reloadKey.value++ })

function openInTab(): void {
  if (frameSrc.value) window.open(frameSrc.value, '_blank')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="capsule.previewId" class="cpm-overlay" :style="{ zIndex }" @click.self="capsule.closePreview()">
      <div class="cpm-modal" @pointerdown="onRaise">
        <div class="cpm-head">
          <span class="cpm-kind">{{ entry?.kind === 'dir' ? '📁' : '📄' }}</span>
          <span class="cpm-name" :title="capsule.previewId">{{ capsule.previewId }}</span>
          <button class="cpm-copy" title="复制「胶囊:文件名」(粘到终端给 claude code 引用)" @click="onCopyName">
            {{ copied ? '✓ 已复制' : '⧉' }}
          </button>
          <span v-if="entry" class="cpm-meta">{{ entry.kind === 'dir' ? `${entry.fileCount} 文件` : `${Math.ceil(entry.size / 1024)}KB` }}</span>
          <button class="cpm-btn" title="重新加载" @click="reloadKey++">↻</button>
          <button class="cpm-btn" title="新窗口打开" @click="openInTab">↗</button>
          <button class="cpm-btn close" title="关闭" @click="capsule.closePreview()">✕</button>
        </div>
        <iframe :key="reloadKey" :src="frameSrc" class="cpm-frame" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cpm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.cpm-modal {
  width: min(1100px, 94vw); height: 88vh;
  display: flex; flex-direction: column;
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.55);
}
.cpm-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
}
.cpm-kind { font-size: 14px; }
.cpm-name {
  flex: 1; min-width: 0;
  font-family: var(--font, monospace); font-size: 13px; font-weight: 600;
  color: var(--text, #c8c8d0);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cpm-meta { font-size: 10px; color: var(--text-dim); flex-shrink: 0; }
/* 文件名后面的复制小按钮(同 wiki 页状态栏样式) */
.cpm-copy {
  height: 20px; padding: 0 8px; flex-shrink: 0;
  font-family: var(--font); font-size: 10px; cursor: pointer;
  color: var(--text-dim); background: transparent;
  border: 1px solid var(--border); border-radius: var(--radius);
  transition: color 0.12s, border-color 0.12s;
}
.cpm-copy:hover { color: var(--glow); border-color: var(--glow-dim); }
.cpm-btn {
  width: 26px; height: 26px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 4px;
  background: transparent; color: var(--text-dim);
  font-size: 12px; cursor: pointer;
}
.cpm-btn:hover { color: var(--text); background: rgba(255,255,255,0.05); }
.cpm-btn.close:hover { color: #f44747; }
.cpm-frame { flex: 1; border: none; background: #fff; }
</style>
