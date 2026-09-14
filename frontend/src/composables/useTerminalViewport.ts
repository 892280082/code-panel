// ── 终端窗口视口布局(切分辨率/拔外接屏)────────────────
//   视口尺寸变化(debounce 300ms,真变化才触发):
//   该尺寸「📍 定位」记过位 → 窗口按从左到右顺序对齐档案槽位
//   (第 i 个窗口 → wins[i],超出叠到最后一槽);
//   没记过 → 仅出界窗口重置回初始居中位(窗口中心出界留 40px 余量)。

import { onMounted, onUnmounted } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import { getLayout, onViewportChange } from '@/utils/viewport-layout'

export function useTerminalViewport() {
  const store = useTerminalStore()
  let offViewportChange: (() => void) | null = null

  function applyViewportLayout(): void {
    const wins = getLayout().wins
    // 只整理「当前视角可见」的窗口 —— 隐藏着的别项目窗口几何不许被动
    const vis = store.visibleList()
    if (wins?.length) {
      const list = vis
        .filter(s => !s.maximized)
        .sort((a, b) => a.x - b.x)
      list.forEach((s, i) => {
        const p = wins[Math.min(i, wins.length - 1)]
        s.x = p.x; s.y = p.y
      })
      store.persistWindows()
      return
    }
    const w = window.innerWidth, h = window.innerHeight
    let changed = false
    for (const s of vis) {
      if (w / 2 + s.x < 40 || w / 2 + s.x > w - 40 || h / 2 + s.y < 40 || h / 2 + s.y > h - 40) {
        s.x = 0; s.y = 0
        changed = true
      }
    }
    if (changed) store.persistWindows()
  }

  onMounted(() => { offViewportChange = onViewportChange(applyViewportLayout) })
  onUnmounted(() => { offViewportChange?.() })
}
