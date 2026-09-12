// ── 全局快捷键(目前一个:显示/隐藏 tmux 终端窗口)────────
//   键位存 localStorage(cp-hotkeys),⚙ →「快捷键」Tab 可改;
//   输入框/文本域内不触发;命中即 preventDefault(如 Ctrl+1
//   是浏览器切标签页的默认键,必须拦下)。

export interface Hotkeys {
  /** 显示/隐藏全部 tmux 终端窗口(无窗口时开命令抽屉) */
  toggleTerm: string
  /** 项目切换器(Alt+Tab 风格:呼出/循环高亮;左右选,回车切) */
  switchProject: string
}

const KEY = 'cp-hotkeys'
const DEFAULTS: Hotkeys = { toggleTerm: 'ctrl+1', switchProject: 'ctrl+2' }

export function getHotkeys(): Hotkeys {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

export function setHotkey(action: keyof Hotkeys, combo: string): void {
  const all = getHotkeys()
  all[action] = combo
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

/** 事件 → 组合串(如 'ctrl+1';仅修饰键按下时返回空串) */
export function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.metaKey) parts.push('meta')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const k = e.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(k)) parts.push(k)
  return parts.join('+')
}

/** 组合串 → 显示名('ctrl+1' → 'Ctrl + 1') */
export function fmtCombo(combo: string): string {
  const name: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: '⌘' }
  return combo.split('+').map(p => name[p] || p.toUpperCase()).join(' + ')
}

/** 挂全局监听:getMap 返回「组合串 → 动作」映射(每次按键实时取,改键即生效)。
 *  ⭐ 捕获阶段挂载:先于任何组件/库(如 xterm)的冒泡处理拿到事件,
 *  它们就算 stopPropagation 也拦不住捕获。
 *  另收 iframe 快捷键桥的 postMessage(public/iframe-hotkey-bridge.js 注入方):
 *  焦点在 PRD/Wiki 渲染 iframe 内时,组合键由桥上报 → 此处同 map 分发。 */
export function startHotkeyListener(getMap: () => Record<string, () => void>): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    const combo = eventCombo(e)
    if (!combo) return
    const fn = getMap()[combo]
    if (fn) { e.preventDefault(); fn() }
  }
  const onBridgeMsg = (ev: MessageEvent): void => {
    if (ev.origin !== location.origin) return // 只认同源 iframe 的上报
    const d = ev.data as { __cpHotkeyBridge?: string } | null
    if (!d || typeof d.__cpHotkeyBridge !== 'string') return
    const fn = getMap()[d.__cpHotkeyBridge]
    if (fn) fn() // preventDefault 已在 iframe 内做过
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('message', onBridgeMsg)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('message', onBridgeMsg)
  }
}
