// ── 终端窗口拖拽(标题栏)────────────────────────────────
//   拖动 = 改窗口 x/y(居中偏移量);松手落三处:
//   ① per-port 位置记忆(该窗口刷新后回原位)
//   ② 窗口清单持久化(restorePersisted 用)
//   ③ 视口布局「最新快照」—— 当前全部窗口从左到右排序,
//      📍 定位按钮存档的来源(见 utils/viewport-layout)。

import { useTerminalStore } from '@/stores/terminal'
import { updateLast, type TermLayout } from '@/utils/viewport-layout'

export function useTerminalDrag() {
  const store = useTerminalStore()

  let dragPort: number | null = null
  let dragStartX = 0, dragStartY = 0
  let dragOrigX = 0, dragOrigY = 0

  function onDragStart(e: MouseEvent, port: number): void {
    const s = store.sessions.get(port)
    if (!s || s.maximized) return   // 最大化时禁止拖动(□ 全屏铺满)
    dragPort = port
    dragStartX = e.clientX; dragStartY = e.clientY
    dragOrigX = s.x; dragOrigY = s.y
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }

  function onDragMove(e: MouseEvent): void {
    if (dragPort === null) return
    e.preventDefault()
    const s = store.sessions.get(dragPort)
    if (!s) return
    s.x = dragOrigX + (e.clientX - dragStartX)
    s.y = dragOrigY + (e.clientY - dragStartY)
  }

  function onDragEnd(): void {
    if (dragPort !== null) {
      const s = store.sessions.get(dragPort)
      if (s) localStorage.setItem(`cmd-terminal-pos-${dragPort}`, JSON.stringify({ x: s.x, y: s.y }))
      store.persistWindows()
      // 📍 快照只记「当前视角可见」的窗口 —— 别的项目隐藏窗口的几何不许串写进档案
      updateLast({ wins: store.visibleList()
        .sort((a, b) => a.x - b.x)
        .map(w => ({ x: w.x, y: w.y })) } satisfies TermLayout)
    }
    dragPort = null
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
  }

  return { onDragStart }
}
