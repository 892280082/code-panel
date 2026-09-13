<script setup lang="ts">
// ── ⚙ 配置「快捷键」Tab ─────────────────────────────────
//   动作:tmux 终端呼出 / 项目切换器 / ⚙ 配置弹窗。
//   点「修改」→ 按下新组合即存(Esc 取消);改完即时生效,无需重启。

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getHotkeys, setHotkey, eventCombo, fmtCombo, type Hotkeys } from '@/utils/hotkeys'

const combo = ref<Hotkeys>(getHotkeys())
const recording = ref<keyof Hotkeys | null>(null)
const note = ref('')

/** 动作清单(新动作在此登记,渲染/改键通用) */
const ACTIONS: Array<{ key: keyof Hotkeys; name: string; desc: string }> = [
  { key: 'toggleTerm', name: '显示 / 隐藏 tmux 终端', desc: '一键收起或恢复全部 tmux 终端窗口;一个都没开时打开命令终端抽屉' },
  { key: 'switchProject', name: '项目切换器(Alt+Tab 风格)', desc: '呼出项目卡片浮层,再按同键循环高亮;← → 选择,Enter 切换,Esc 取消' },
  { key: 'openConfig', name: '打开 / 关闭 ⚙ 配置', desc: '默认 Ctrl + `(1 左边反引号键)呼出全局配置弹窗,再按同键或 Esc 关闭' },
]

function startRecord(action: keyof Hotkeys): void {
  recording.value = action
  note.value = ''
  window.addEventListener('keydown', onRecordKey, true)
}

function stopRecord(): void {
  recording.value = null
  window.removeEventListener('keydown', onRecordKey, true)
}

function onRecordKey(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') { stopRecord(); return }
  const c = eventCombo(e)
  if (!c || c === 'ctrl' || c === 'meta' || c === 'alt' || c === 'shift') return  // 只按了修饰键 → 继续等
  // 必须带修饰键(Ctrl/⌘/Alt),避免吞掉普通按键
  if (!/^ctrl|^meta|^alt/.test(c)) {
    note.value = '需搭配 Ctrl / ⌘ / Alt 修饰键'
    return
  }
  setHotkey(recording.value ?? 'toggleTerm', c)
  combo.value = getHotkeys()
  note.value = `✅ 已改为 ${fmtCombo(c)}`
  stopRecord()
}

onMounted(() => { combo.value = getHotkeys() })
onBeforeUnmount(stopRecord)
</script>

<template>
  <div class="hk">
    <div v-for="a in ACTIONS" :key="a.key" class="hk-row">
      <div class="hk-info">
        <div class="hk-name">{{ a.name }}</div>
        <div class="hk-desc">{{ a.desc }}</div>
      </div>
      <template v-if="recording !== a.key">
        <span class="hk-key">{{ fmtCombo(combo[a.key]) }}</span>
        <button class="hk-btn" @click="startRecord(a.key)">修改</button>
      </template>
      <template v-else>
        <span class="hk-key rec">按下新组合…</span>
        <button class="hk-btn" @click="stopRecord">取消</button>
      </template>
    </div>
    <p v-if="note" class="hk-note" :class="{ warn: note.includes('需') }">{{ note }}</p>
    <p class="hk-tip">录入提示:新组合需带 Ctrl / ⌘ / Alt;Esc 取消;输入框内快捷键不触发</p>
    <p class="hk-tip">⚠ 焦点在浏览器地址栏时(如刚点了刷新按钮)快捷键不生效 —— 点击页面任意处即可恢复</p>
  </div>
</template>

<style scoped>
.hk { display: flex; flex-direction: column; gap: 10px; }
.hk-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg, #09090b);
}
.hk-info { flex: 1; min-width: 0; }
.hk-name { font-size: 12px; font-weight: 600; color: var(--text); }
.hk-desc { margin-top: 3px; font-size: 11px; color: var(--text-dim); line-height: 1.6; }
.hk-key {
  flex-shrink: 0;
  font-family: var(--font, monospace); font-size: 11px;
  padding: 4px 10px;
  color: var(--glow, #22ee66);
  border: 1px solid var(--glow-dim); border-radius: 6px;
  background: rgba(34,238,102,0.06);
  white-space: nowrap;
}
.hk-key.rec { color: var(--text-dim); border-color: var(--border); animation: hk-blink 1s infinite; }
@keyframes hk-blink { 50% { opacity: 0.5; } }
.hk-btn {
  flex-shrink: 0;
  font-size: 11px; padding: 4px 12px; cursor: pointer;
  color: var(--text-dim); background: transparent;
  border: 1px solid var(--border); border-radius: 4px;
}
.hk-btn:hover { color: var(--glow); border-color: var(--glow-dim); }
.hk-note { margin: 0; font-size: 11px; color: var(--glow); }
.hk-note.warn { color: #f44747; }
.hk-tip { margin: 0; font-size: 10px; color: var(--text-dim); opacity: 0.7; }
</style>
