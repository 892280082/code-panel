// ── iframe 快捷键桥(由父页面注入;PRD/Wiki 渲染 iframe 通用)──────
//   痛点:焦点落进原型/文档 iframe 后,Ctrl+1 等全局快捷键被 iframe 吞掉,
//   父页面(window 捕获阶段)收不到 → 终端呼不出。
//   本脚本在 iframe 文档内捕获带修饰键的组合 → postMessage 上报父页面,
//   父页面热键系统(utils/hotkeys.ts)按同一 combo 映射执行 —— 跨 iframe 冒泡。
//   自我复制:本页内层的 iframe(md 渲染页里内嵌的原型 html)load 后同样注入,
//   用 <script src> 引用天然可递归,任意深度;跨域 iframe 注入失败自动跳过。
(function () {
  if (window.__cpHotkeyBridge) return
  window.__cpHotkeyBridge = true

  document.addEventListener('keydown', function (e) {
    var t = e.target
    // 输入控件内不触发(与父页面热键系统同规则)
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    var parts = []
    if (e.ctrlKey) parts.push('ctrl')
    if (e.metaKey) parts.push('meta')
    if (e.altKey) parts.push('alt')
    if (e.shiftKey) parts.push('shift')
    var k = (e.key || '').toLowerCase()
    if (!k || ['control', 'meta', 'alt', 'shift'].indexOf(k) >= 0) return
    parts.push(k)
    var combo = parts.join('+')
    // 必须带 Ctrl/⌘/Alt(与父页面规则一致,不吞普通按键)
    if (!/^ctrl|^meta|^alt/.test(combo)) return
    e.preventDefault() // 拦浏览器默认(如 Ctrl+1 切标签);动作由父页面决定
    try { parent.postMessage({ __cpHotkeyBridge: combo }, location.origin) } catch (err) { /* 跨域父页面 */ }
  }, true)

  // ── 自我复制到内层 iframe ──────────────────────────────
  function injectFrame(f) {
    try {
      var d = f.contentDocument
      if (!d) return
      if (d.querySelector('script[data-cp-bridge]')) return // 幂等
      var s = d.createElement('script')
      s.src = '/iframe-hotkey-bridge.js'
      s.setAttribute('data-cp-bridge', '1')
      ;(d.head || d.documentElement).appendChild(s)
    } catch (err) { /* 跨域跳过 */ }
  }
  document.querySelectorAll('iframe').forEach(injectFrame)
  document.addEventListener('load', function (e) {
    if (e.target && e.target.tagName === 'IFRAME') injectFrame(e.target)
  }, true)
})()
