// ── 终端窗口拖拽(标题栏,Pointer Events + 指针捕获)──────
//   ⭐ 不跟手的根因(修复记录):窗口 90% 面积是终端 iframe(独立文档),
//     鼠标拖快一点越过标题栏,父文档的 mousemove 就收不到(事件被 iframe
//     吞掉)→ 窗口停在原地,鼠标晃回标题栏/窗口外才继续追。
//     → pointerdown 立刻 setPointerCapture:后续 pointermove/up 全部由
//       标题栏元素接收,指针飘到 iframe 上/窗外都不丢事件,全程跟手。
//   拖动 = 改窗口 x/y(居中偏移量);松手落三处:
//   ① per-port 位置记忆(该窗口刷新后回原位)
//   ② 窗口清单持久化(restorePersisted 用)
//   ③ 视口布局「最新快照」—— 当前全部窗口从左到右排序,
//      📍 定位按钮存档的来源(见 utils/viewport-layout)。

import { useTerminalStore } from '@/stores/terminal'
import { updateLast, type TermLayout } from '@/utils/viewport-layout'

export function useTerminalDrag() {
  const store = useTerminalStore()

  function onDragStart(e: PointerEvent, port: number): void {
    const s = store.sessions.get(port)
    if (!s || s.maximized) return   // 最大化时禁止拖动(□ 全屏铺满)
    if (e.button !== 0) return      // 只跟主键(左键/触摸/笔)拖动

    const header = e.currentTarget as HTMLElement
    const startX = e.clientX, startY = e.clientY
    const origX = s.x, origY = s.y
    let moved = false

    // ⭐ 指针捕获:事件不再被终端 iframe 吞掉(见文件头注释)
    try { header.setPointerCapture(e.pointerId) } catch { /* 极老浏览器:退化为普通监听 */ }

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY
      if (!moved && dx === 0 && dy === 0) return
      moved = true
      ev.preventDefault()
      s.x = origX + dx
      s.y = origY + dy
    }
    const onEnd = (): void => {
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onEnd)
      header.removeEventListener('pointercancel', onEnd)
      if (!moved) return   // 只点了一下(没拖)→ 不写持久化
      localStorage.setItem(`cmd-terminal-pos-${port}`, JSON.stringify({ x: s.x, y: s.y }))
      store.persistWindows()
      // 📍 快照只记「当前视角可见」的窗口 —— 别的项目隐藏窗口的几何不许串写进档案
      updateLast({ wins: store.visibleList()
        .sort((a, b) => a.x - b.x)
        .map(w => ({ x: w.x, y: w.y })) } satisfies TermLayout)
    }
    header.addEventListener('pointermove', onMove)
    header.addEventListener('pointerup', onEnd)
    header.addEventListener('pointercancel', onEnd)
  }

  return { onDragStart }
}
