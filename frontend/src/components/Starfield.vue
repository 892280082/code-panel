<script setup lang="ts">
// ── 夜空星星 · 全幅背景层(空态)────────────────────────
//   绝对定位铺满父容器(preserveAspectRatio slice 等比裁切):
//   三档星(微星慢闪/中星带色温快闪/亮星十字光芒)+ 流星 + 星云雾。
//   父容器须 position:relative + overflow:hidden。
import { computed } from 'vue'

/** 确定性伪随机 [0,1) */
const rnd = (i: number): number => {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** 大画布:slice 裁切下各屏比例都铺满,星星尺寸稳定 */
const W = 1200
const H = 700

interface Star { x: number; y: number; r: number; o: number; d: number; dur: number; c: string }
const TINT = ['#e8ecf4', '#e8ecf4', '#e8ecf4', '#bcd6ff', '#ffe9b0']   // 银白为主,少数淡蓝/淡黄

/** 微星(多、暗、慢闪) */
const tiny = computed<Star[]>(() => Array.from({ length: 150 }, (_, i) => ({
  x: rnd(i * 2 + 1) * W,
  y: rnd(i * 2 + 2) * H,
  r: 0.6 + rnd(i + 3) * 0.7,
  o: 0.12 + rnd(i + 4) * 0.4,
  d: +(rnd(i + 5) * 5).toFixed(2),
  dur: +(3 + rnd(i + 6) * 2.5).toFixed(2),
  c: TINT[Math.floor(rnd(i + 7) * TINT.length)],
})))

/** 中星(亮、快闪、带色温) */
const mid = computed<Star[]>(() => Array.from({ length: 34 }, (_, i) => ({
  x: rnd(i * 3 + 31) * W,
  y: rnd(i * 3 + 32) * H,
  r: 1.2 + rnd(i + 33) * 0.6,
  o: 0.5 + rnd(i + 34) * 0.45,
  d: +(rnd(i + 35) * 3).toFixed(2),
  dur: +(2 + rnd(i + 36) * 1.6).toFixed(2),
  c: TINT[Math.floor(rnd(i + 37) * TINT.length)],
})))

/** 亮星(十字光芒 + 光晕,呼吸) */
const bright = computed(() => Array.from({ length: 7 }, (_, i) => ({
  x: 80 + rnd(i * 5 + 71) * (W - 160),
  y: 50 + rnd(i * 5 + 72) * (H - 100),
  r: 1.6 + rnd(i + 73) * 0.7,
  d: +(rnd(i + 74) * 3.6).toFixed(2),
  c: ['#f4f7fc', '#d9e8ff', '#fff3d6'][i % 3],
})))
</script>

<template>
  <svg class="starfield" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <radialGradient id="sf-neb1" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#5a7db8" stop-opacity="0.12" />
        <stop offset="1" stop-color="#5a7db8" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="sf-neb2" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#7b6bb5" stop-opacity="0.09" />
        <stop offset="1" stop-color="#7b6bb5" stop-opacity="0" />
      </radialGradient>
      <filter id="sf-glow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <linearGradient id="sf-meteor" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" />
        <stop offset="1" stop-color="#fff" stop-opacity="0.9" />
      </linearGradient>
    </defs>

    <!-- 星云雾 -->
    <ellipse cx="360" cy="240" rx="340" ry="180" fill="url(#sf-neb1)" />
    <ellipse cx="880" cy="470" rx="300" ry="160" fill="url(#sf-neb2)" />

    <!-- 微星 + 中星 -->
    <circle v-for="(s, i) in tiny" :key="'t' + i" class="tw" :cx="s.x" :cy="s.y" :r="s.r"
      :fill="s.c" :opacity="s.o" :style="{ animationDelay: s.d + 's', animationDuration: s.dur + 's' }" />
    <circle v-for="(s, i) in mid" :key="'m' + i" class="tw" :cx="s.x" :cy="s.y" :r="s.r"
      :fill="s.c" :opacity="s.o" :style="{ animationDelay: s.d + 's', animationDuration: s.dur + 's' }" />

    <!-- 亮星:光晕 + 十字光芒 + 核心 -->
    <g v-for="(s, i) in bright" :key="'b' + i">
      <g class="pulse" :style="{ animationDelay: s.d + 's' }">
        <circle :cx="s.x" :cy="s.y" :r="s.r * 3.4" :fill="s.c" filter="url(#sf-glow)" opacity="0.32" />
        <line :x1="s.x - s.r * 5" :y1="s.y" :x2="s.x + s.r * 5" :y2="s.y" :stroke="s.c" stroke-width="0.8" opacity="0.7" />
        <line :x1="s.x" :y1="s.y - s.r * 5" :x2="s.x" :y2="s.y + s.r * 5" :stroke="s.c" stroke-width="0.8" opacity="0.7" />
        <circle :cx="s.x" :cy="s.y" :r="s.r" :fill="s.c" />
      </g>
    </g>

    <!-- 流星(周期划过,大部分时间隐身) -->
    <g class="meteor">
      <line x1="0" y1="0" x2="180" y2="0" stroke="url(#sf-meteor)" stroke-width="2" stroke-linecap="round" />
      <circle cx="180" cy="0" r="2.2" fill="#fff" />
    </g>
  </svg>
</template>

<style scoped>
.starfield {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}

.tw { animation: sf-tw 3s ease-in-out infinite; }
@keyframes sf-tw { 0%, 100% { opacity: 0.15; } 50% { opacity: 1; } }

.pulse { animation: sf-pulse 3.6s ease-in-out infinite; }
@keyframes sf-pulse { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }

/* 流星:7.5s 一颗;从右上向左下横贯画布 */
.meteor { animation: sf-meteor 7.5s ease-in infinite; opacity: 0; }
@keyframes sf-meteor {
  0%, 86%, 100% { opacity: 0; transform: translate(1150px, 60px) rotate(23deg); }
  88%           { opacity: 1; }
  97%           { opacity: 0; transform: translate(240px, 440px) rotate(23deg); }
}
</style>
