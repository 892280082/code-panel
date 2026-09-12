<script setup lang="ts">
// ── 时空胶囊通知卡片(全局挂 App.vue)───────────────────
//   新胶囊/更新到达即从右上角滑入(用户核心诉求:主动弹出来);
//   15s 自动消失(store 管理);只做通知:查看/关闭,
//   并入 wiki 的操作在列表页的行按钮上。

import { useCapsuleStore } from '@/stores/capsule';
import { useOverlayLayer } from '@/utils/z-layer';
import { fmtTime } from '@/utils/format';

const capsule = useCapsuleStore();
const { zIndex, onRaise } = useOverlayLayer(() => capsule.toasts.length > 0);
</script>

<template>
  <Teleport to="body">
    <div v-if="capsule.toasts.length" class="ct-stack" :style="{ zIndex }" @pointerdown="onRaise">
      <div
        v-for="t in capsule.toasts" :key="t.id"
        class="ct-card"
        @click="capsule.openPreview(t.id)"
      >
        <div class="ct-title">
          <span class="ct-ico">⏳</span>
          {{ t.event === 'new' ? '新时空胶囊' : '时空胶囊已更新' }}
          <span class="ct-kind">{{ t.kind === 'dir' ? '📁' : '📄' }}</span>
          <button class="ct-close" title="关闭" @click.stop="capsule.dismissToast(t.id)">✕</button>
        </div>
        <div class="ct-name">{{ t.id }}</div>
        <div class="ct-foot">
          <span class="ct-time">{{ fmtTime(t.ts) }}</span>
          <span class="ct-view">点击查看 →</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ct-stack {
  position: fixed; top: 40px; right: 14px;
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
}
.ct-card {
  pointer-events: auto;
  width: 320px;
  background: var(--surface, #131316);
  border: 1px solid var(--glow-dim, #116633);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.5);
  padding: 10px 12px;
  cursor: pointer;
  animation: ct-in 0.25s ease-out;
  transition: border-color 0.15s;
}
.ct-card:hover { border-color: var(--glow, #22ee66); }
@keyframes ct-in {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.ct-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--text, #c8c8d0);
}
.ct-ico { font-size: 13px; }
.ct-kind { font-size: 11px; }
.ct-close {
  margin-left: auto; background: transparent; border: none;
  color: var(--text-dim, #6b6b78); cursor: pointer; font-size: 12px;
  padding: 1px 4px; border-radius: 4px;
}
.ct-close:hover { color: #f44747; background: rgba(244,71,71,0.1); }
.ct-name {
  margin-top: 5px;
  font-family: var(--font, monospace); font-size: 12px;
  color: var(--glow, #22ee66);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ct-foot {
  margin-top: 7px;
  display: flex; align-items: center;
  font-size: 10px; color: var(--text-dim, #6b6b78);
}
.ct-view { margin-left: auto; color: var(--glow, #22ee66); }
</style>
