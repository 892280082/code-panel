// ── iframe 快捷键桥 · 注入端(PRD/Wiki 渲染 iframe 通用)────────
//   onload 后向同源 iframe 文档插入 <script src="/iframe-hotkey-bridge.js">;
//   脚本本体在 public/(静态直出,不经打包,src 引用可自我复制到内层 iframe)。
//   父页面接收端见 utils/hotkeys.ts 的 startHotkeyListener(message 分发)。

export function injectHotkeyBridge(iframe: HTMLIFrameElement | null): void {
  if (!iframe) return
  try {
    const doc = iframe.contentDocument
    if (!doc) return // 跨域(外链原型)注入不了,静默
    if (doc.querySelector('script[data-cp-bridge]')) return // 幂等(重复 load)
    const s = doc.createElement('script')
    s.src = '/iframe-hotkey-bridge.js'
    s.setAttribute('data-cp-bridge', '1')
    ;(doc.head || doc.documentElement).appendChild(s)
  } catch { /* 跨域或文档未就绪,静默 */ }
}
