<script setup lang="ts">
// ── diff 概览条(VSCode 式 ruler)─────────────────────────
//   绿块 = 新增、红块 = 删除,按行号比例分布;点击/按住拖动跳转。
//   用法:与滚动容器并排 flex;监听 @jump(ratio) 由父级执行滚动,
//   或传入 target(ref)组件内直接滚。

import { ref } from 'vue'

export interface RulerBlock { top: number; height: number; type: 'addition' | 'deletion' }

const props = defineProps<{
  blocks: RulerBlock[]
  /** 滚动目标容器(传入则组件内直接滚动) */
  target?: HTMLElement | null
}>()

const emit = defineEmits<{ (e: 'jump', ratio: number): void }>()

const rulerRef = ref<HTMLElement | null>(null)

function jump(e: MouseEvent): void {
  const ruler = rulerRef.value
  if (!ruler) return
  const rect = ruler.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  if (props.target) {
    props.target.scrollTop = ratio * props.target.scrollHeight - props.target.clientHeight / 2
  }
  emit('jump', ratio)
}

function onDown(e: MouseEvent): void {
  jump(e)
  const move = (ev: MouseEvent) => jump(ev)
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<template>
  <div
    ref="rulerRef"
    class="diff-ruler"
    title="diff 概览:绿=新增 红=删除,点击跳转"
    @mousedown="onDown"
  >
    <span
      v-for="(b, i) in blocks" :key="i"
      class="ruler-block" :class="b.type"
      :style="{ top: (b.top * 100) + '%', height: (Math.max(b.height * 100, 0.6)) + '%' }"
    />
  </div>
</template>

<style scoped>
.diff-ruler {
  width: 18px; flex: none; position: relative; cursor: pointer;
  background: rgba(255,255,255,0.03); border-left: 1px solid rgba(255,255,255,0.06);
}
.diff-ruler:hover { background: rgba(255,255,255,0.06); }
.ruler-block { position: absolute; left: 2px; right: 2px; border-radius: 1px; min-height: 2px; }
.ruler-block.addition { background: var(--glow, #22ee66); }
.ruler-block.deletion { background: var(--danger, #f44747); }
</style>
