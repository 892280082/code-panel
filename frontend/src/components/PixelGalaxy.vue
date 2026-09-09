<script setup lang="ts">
// ── 像素银河(空态装饰)─────────────────────────────────
//   对数螺旋双臂(像素方块,近核大远端小)+ 亮核光晕 + 银白散星;
//   臂慢旋转,散星独立闪烁。全部确定性生成(无随机,重渲不闪)。
import { computed } from 'vue'

withDefaults(defineProps<{ size?: number }>(), { size: 140 })

interface Px { x: number; y: number; s: number; o: number; c: string }

/** 确定性伪随机 [0,1) */
const rnd = (i: number): number => {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return v - Math.floor(v)
}

// 旋臂:绿为主,混银白/浅绿点缀(面板主题色系)
const pixels = computed<Px[]>(() => {
  const colors = ['#22ee66', '#7ef7a2', '#d8dee9', '#9fe8b8', '#eafff0']
  const out: Px[] = []
  for (let arm = 0; arm < 2; arm++) {
    const phase = arm * Math.PI
    for (let i = 0; i <= 46; i++) {
      const t = i / 46
      const th = t * Math.PI * 2.05 + phase          // 螺旋角(两臂相位差 π)
      const r = 5 + t * 42                            // 半径
      const x = 60 + Math.cos(th) * r + (rnd(i + arm * 100) - 0.5) * 4
      const y = 60 + Math.sin(th) * r * 0.82 + (rnd(i + arm * 100 + 7) - 0.5) * 4   // 稍扁=盘面透视
      const s = 3.4 - t * 2.0                         // 近核大、远端小
      out.push({ x: x - s / 2, y: y - s / 2, s, o: 0.95 - t * 0.62, c: colors[i % colors.length] })
    }
  }
  return out
})

// 中心亮核:十字像素块
const corePixels = [
  { x: 58.5, y: 58.5, s: 3 }, { x: 55, y: 59.5, s: 2 }, { x: 63, y: 59.5, s: 2 },
  { x: 59.5, y: 55, s: 2 }, { x: 59.5, y: 63, s: 2 },
]

// 散星(不随臂转,独立闪烁;delay 错开)
const stars = computed(() => Array.from({ length: 14 }, (_, i) => ({
  x: 6 + rnd(i * 3 + 1) * 108,
  y: 6 + rnd(i * 3 + 2) * 108,
  s: i % 3 === 0 ? 2 : 1,
  d: +(rnd(i * 3 + 3) * 2.6).toFixed(2),
})))
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 120 120" class="px-galaxy" aria-hidden="true">
    <defs>
      <radialGradient id="pxg-core" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#eafff0" stop-opacity="0.9" />
        <stop offset="0.45" stop-color="#22ee66" stop-opacity="0.3" />
        <stop offset="1" stop-color="#22ee66" stop-opacity="0" />
      </radialGradient>
    </defs>
    <g class="galaxy-spin">
      <circle cx="60" cy="60" r="17" fill="url(#pxg-core)" />
      <rect v-for="(p, i) in corePixels" :key="'c' + i" :x="p.x" :y="p.y" :width="p.s" :height="p.s" fill="#eafff0" opacity="0.95" />
      <rect v-for="(p, i) in pixels" :key="i" :x="p.x" :y="p.y" :width="p.s" :height="p.s" :fill="p.c" :opacity="p.o" />
    </g>
    <rect
      v-for="(s, i) in stars" :key="'s' + i" class="tw" :x="s.x" :y="s.y"
      :width="s.s" :height="s.s" fill="#d8dee9" :style="{ animationDelay: s.d + 's' }"
    />
  </svg>
</template>

<style scoped>
.px-galaxy { image-rendering: pixelated; flex-shrink: 0; }
/* 逆时针 = 尾随臂(臂尖落后被拖拽,真实星系的风车感);顺时针会变领先臂,像倒转 */
.galaxy-spin { transform-origin: 60px 60px; animation: pxg-spin 46s linear infinite; }
@keyframes pxg-spin { to { transform: rotate(-360deg); } }
.tw { animation: pxg-twinkle 2.6s ease-in-out infinite; }
@keyframes pxg-twinkle { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.9; } }
</style>
