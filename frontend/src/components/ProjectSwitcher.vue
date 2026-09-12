<script setup lang="ts">
// ── 项目切换器浮层(Ctrl+2 呼出;左右选,回车切,Esc 关)────
//   Alt+Tab 风格:当前项目默认高亮,再按热键循环下一个。
import { watch, ref, onBeforeUnmount } from 'vue'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'

const { open, selIdx, list, curId, step, confirm, close } = useProjectSwitcher()
const panelEl = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); confirm() }
  else if (e.key === 'Escape') { e.preventDefault(); close() }
}

watch(open, (v) => {
  if (v) {
    window.addEventListener('keydown', onKey, true)
    requestAnimationFrame(() => panelEl.value?.focus())
  } else {
    window.removeEventListener('keydown', onKey, true)
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ps-mask" @click.self="close">
      <div ref="panelEl" class="ps-panel" tabindex="-1">
        <div class="ps-head">切换项目 <span class="ps-hint">← → 选择 · Enter 切换 · Esc 取消</span></div>
        <div class="ps-row">
          <div
            v-for="(p, i) in list" :key="p.id"
            class="ps-card"
            :class="{ sel: i === selIdx, cur: p.id === curId }"
            @click="confirm(i)"
            @mouseenter="selIdx = i"
          >
            <span class="ps-icon">🗂</span>
            <span class="ps-name">{{ p.name }}</span>
            <span class="ps-note">{{ p.note || `#${p.id}` }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ps-mask {
  position: fixed; inset: 0; z-index: 15000;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}
.ps-panel {
  max-width: min(1376px, 94vw);   /* 860 × 1.6 */
  background: var(--surface, #101014);
  border: 1px solid var(--border, #23232a); border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  padding: 19px; outline: none;   /* 12 × 1.6 */
}
.ps-head {
  font-size: 19px; font-weight: 700; color: var(--text, #c8c8d0);
  padding: 3px 6px 16px; letter-spacing: 0.04em;
}
.ps-hint { font-size: 16px; font-weight: 400; color: var(--text-dim, #6b6b78); margin-left: 13px; }
.ps-row { display: flex; gap: 13px; flex-wrap: wrap; }
.ps-card {
  display: flex; flex-direction: column; gap: 6px; min-width: 208px; max-width: 320px; /* 130/200 × 1.6 */
  padding: 16px 19px; cursor: pointer; border-radius: 13px;
  border: 1px solid var(--border, #23232a); background: var(--bg, #09090b);
  transition: border-color 0.1s, background 0.1s, transform 0.1s;
}
.ps-card:hover { border-color: var(--glow-dim, rgba(34,238,102,0.3)); }
.ps-card.sel {
  border-color: var(--glow, #22ee66); background: rgba(34,238,102,0.07);
  transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.ps-icon { font-size: 29px; position: relative; }   /* 18 × 1.6 */
.ps-card.cur .ps-icon::after {
  content: '● 当前'; font-size: 14px; color: var(--glow, #22ee66);
  position: absolute; left: 42px; top: 7px; white-space: nowrap;
}
.ps-name { font-size: 19px; color: var(--text, #c8c8d0); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-note { font-size: 16px; color: var(--text-dim, #6b6b78); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
