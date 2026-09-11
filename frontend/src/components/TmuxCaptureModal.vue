<script setup lang="ts">
// ── Tmux 抓屏复制弹窗(全局唯一,App 挂载一次)────────────
//   打开方:终端窗口标题栏 ⧉ 按钮 / 会话列表「复制」按钮
//   (都调 terminal.openCapture)。
//   背景:tmux mouse on 截获网页拖选(Mac 浏览器无 Shift 绕过)、
//   ttyd 不支持 OSC52 —— 后端 capture-pane 出纯文本,弹窗里随意选/
//   一键复制,是网页远程时唯一可靠的复制通道。

import { apiFetch } from '@/utils/api-fetch'
import { ref, watch } from 'vue'
import { useTerminalStore } from '@/stores/terminal'

const terminal = useTerminalStore()

const capLines = ref(200)
const capText = ref('')
const capLoading = ref(false)
const capError = ref('')
const capCopied = ref(false)

async function fetchCapture() {
  const t = terminal.capTarget
  if (!t || !t.project) return
  capLoading.value = true; capError.value = ''; capCopied.value = false
  try {
    const q = `project=${encodeURIComponent(t.project)}&name=${encodeURIComponent(t.fullName)}&lines=${capLines.value}`
    const res = await apiFetch(`/api/terminal/tmux/capture?${q}`)
    const data = await res.json()
    if (!data.ok) { capError.value = data.error || '抓屏失败'; capText.value = '' }
    else capText.value = data.data.text
  } catch {
    capError.value = '网络错误'
  } finally {
    capLoading.value = false
  }
}

// 打开即抓屏(换目标重开也触发 —— openCapture 每次放新对象)
watch(() => terminal.capTarget, (t) => { if (t) fetchCapture() })

/** 剪贴板写入:secure context(localhost/https)走 navigator.clipboard;
 *  内网 http 下该 API 不存在 → execCommand 兜底(用户手势点击内有效) */
async function copyAll(): Promise<void> {
  const text = capText.value
  if (!text) return
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
  }
  capCopied.value = ok
  if (ok) setTimeout(() => { capCopied.value = false }, 1500)
}
</script>

<template>
  <!-- 抓屏复制弹窗:后端 capture-pane 出纯文本,弹窗内可拖选局部或一键复制全部 -->
  <Teleport to="body">
    <div v-if="terminal.capTarget" class="cap-overlay" @click.self="terminal.closeCapture()">
      <div class="cap-card">
        <div class="cap-head">
          <span class="cap-title">复制 · {{ terminal.capTarget.label }}</span>
          <select v-model="capLines" class="cap-lines" @change="fetchCapture">
            <option :value="200">最近 200 行</option>
            <option :value="500">最近 500 行</option>
            <option :value="1000">最近 1000 行</option>
          </select>
          <button class="cap-btn primary" :disabled="!capText || capLoading" @click="copyAll">
            {{ capCopied ? '✓ 已复制' : '复制全部' }}
          </button>
          <button class="cap-btn" @click="terminal.closeCapture()">关闭</button>
        </div>
        <div v-if="capLoading" class="cap-msg">抓屏中…</div>
        <div v-else-if="capError" class="cap-msg err">{{ capError }}</div>
        <pre v-else class="cap-pre">{{ capText || '(无内容)' }}</pre>
        <div class="cap-foot">弹窗内文字可手动拖选复制局部 · 鼠标模式为「开」时,这里是网页里唯一可靠的复制通道</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── 抓屏复制弹窗(Teleport 到 body;压过终端窗口)── */
.cap-overlay {
  position: fixed; inset: 0; z-index: 30001;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.cap-card {
  width: min(860px, 92vw); max-height: 82vh;
  display: flex; flex-direction: column;
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 10px;
  overflow: hidden;
}
.cap-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #23232a);
}
.cap-title {
  flex: 1; min-width: 0;
  font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cap-lines {
  padding: 4px 6px;
  border: 1px solid var(--border, #23232a); border-radius: 4px;
  background: var(--bg, #09090b);
  color: var(--text-dim, #6b6b78);
  font-size: 11px; outline: none;
}
.cap-btn {
  padding: 4px 12px;
  border: 1px solid var(--border, #23232a); border-radius: 4px;
  background: transparent;
  color: var(--text-dim, #6b6b78);
  font-size: 11px; cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.cap-btn:hover:not(:disabled) { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.05); }
.cap-btn:disabled { opacity: 0.4; cursor: default; }
.cap-btn.primary {
  border: none;
  background: var(--glow, #22ee66);
  color: #09090b; font-weight: 600;
}
.cap-pre {
  flex: 1; margin: 0; padding: 12px;
  overflow: auto;
  font-family: var(--font, monospace);
  font-size: 12px; line-height: 1.5;
  color: var(--text, #c8c8d0);
  white-space: pre-wrap; word-break: break-all;
  user-select: text;
}
.cap-msg {
  padding: 32px; text-align: center;
  color: var(--text-dim, #6b6b78); font-size: 12px;
}
.cap-msg.err { color: #f44747; }
.cap-foot {
  padding: 6px 12px;
  border-top: 1px solid var(--border, #23232a);
  color: var(--text-dim, #6b6b78); font-size: 10px;
}
</style>
