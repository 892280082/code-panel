<script setup lang="ts">
// ── ⚙ 配置「装修」Tab ─────────────────────────────────
//   界面主题(浅色/深色)+ 浏览器标签 favicon 换色:同一款 </> 终端
//   造型 8 种颜色,多台电脑各设一色,标签一眼区分。选择即保存,即时生效。

import { ref, onMounted } from 'vue'
import { apiJson, errText } from '@/utils/api-fetch'

interface Preset { id: string; label: string; color: string }
type Theme = 'light' | 'dark'

const THEME_KEY = 'code-panel-theme'

const theme = ref<Theme>('light')

const presets = ref<Preset[]>([])
const current = ref('green')
const loading = ref(true)
const busy = ref(false)
const note = ref('')
const errMsg = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await apiJson<{ data: { presets: Preset[]; current: string } }>('/api/appearance/favicon')
    presets.value = data.data.presets
    current.value = data.data.current
  } catch (e) {
    errMsg.value = errText(e, '读取失败')
  } finally {
    loading.value = false
  }
}

async function pick(id: string): Promise<void> {
  if (busy.value || id === current.value) return
  busy.value = true
  note.value = ''
  errMsg.value = ''
  try {
    await apiJson('/api/appearance/favicon', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: id }),
    })
    current.value = id
    swapTabIcon()
    note.value = '✓ 已保存,浏览器标签图标已换色'
  } catch (e) {
    errMsg.value = errText(e, '保存失败')
  } finally {
    busy.value = false
  }
}

/** 换掉当前标签页的 icon(带时间戳避开缓存;其他标签页刷新后跟进) */
function swapTabIcon(): void {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (link) link.href = `/favicon.svg?v=${Date.now()}`
}

// ── 界面主题(纯前端:localStorage + <html> data-theme,不进后端;默认深色)──
function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function setTheme(t: Theme): void {
  if (t === theme.value) return
  theme.value = t
  try { localStorage.setItem(THEME_KEY, t) } catch { /* ignore */ }
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
}

onMounted(() => {
  theme.value = readTheme()
  load()
})
</script>

<template>
  <div class="ap-panel">
    <div class="cfg-card">
      <div class="cfg-title">🌗 界面主题(浅色 / 深色)</div>
      <div class="cfg-hint">
        整套配色一键切换。选择存在本浏览器(localStorage),即时生效,不影响其他设备与其他账号。
      </div>

      <div class="theme-row">
        <button
          class="theme-opt" :class="{ on: theme === 'light' }"
          title="浅色:近白底,适合白天 / 强光环境"
          @click="setTheme('light')"
        >
          <span class="theme-chip light"></span>浅色
          <span class="swatch-check" :class="{ show: theme === 'light' }">✓</span>
        </button>
        <button
          class="theme-opt" :class="{ on: theme === 'dark' }"
          title="深色:原 Terminal Noir"
          @click="setTheme('dark')"
        >
          <span class="theme-chip dark"></span>深色
          <span class="swatch-check" :class="{ show: theme === 'dark' }">✓</span>
        </button>
      </div>
    </div>

    <div class="cfg-card">
      <div class="cfg-title">🎨 标签图标(favicon)换色</div>
      <div class="cfg-hint">
        同一款 &lt;/&gt; 终端造型,8 种颜色任选 —— 多台电脑各设一色,浏览器标签一眼区分。选择即保存,即时生效。
      </div>
      <div v-if="errMsg" class="form-error">{{ errMsg }}</div>

      <div class="swatches" :class="{ dim: loading || busy }">
        <button
          v-for="p in presets" :key="p.id"
          class="swatch" :class="{ on: p.id === current }"
          :style="{ '--c': p.color }"
          :disabled="busy"
          :title="p.label"
          @click="pick(p.id)"
        >
          <span class="icon-chip" :style="{ background: p.color, boxShadow: `0 0 12px ${p.color}40` }">&lt;/&gt;</span>
          <span class="swatch-label">{{ p.label.replace('(默认)', '') }}</span>
          <span class="swatch-check" :class="{ show: p.id === current }">✓</span>
        </button>
      </div>

      <p v-if="note" class="ok">{{ note }}</p>
      <p class="cfg-hint tip">💡 本页与刷新后的新标签页都显示新色;若图标迟迟不变,Ctrl+Shift+R 强刷一次(浏览器缓存)。</p>
    </div>
  </div>
</template>

<style scoped>
.ap-panel { display: flex; flex-direction: column; gap: 10px; }
.cfg-card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a); border-radius: 8px;
}
.cfg-title { font-size: 13px; color: var(--text, #c8c8d0); font-weight: 600; }
.cfg-hint.tip { margin: 0; opacity: 0.8; }
.form-error { color: var(--danger); font-size: 11px; margin: 0; }
.ok { color: var(--glow, #22ee66); font-size: 11px; margin: 0; }

.swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.swatches.dim { opacity: 0.6; }
.swatch {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px 9px;
  background: transparent; border: 1px solid var(--border, #23232a); border-radius: 8px;
  cursor: pointer;
}
.swatch:hover:not(:disabled) { border-color: var(--c); }
.swatch.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 7%, transparent); }
.swatch:disabled { cursor: default; }
.swatch-check {
  position: absolute; top: 5px; right: 7px;
  font-size: 11px; color: var(--c);
  opacity: 0; transition: opacity 0.15s;
}
.swatch-check.show { opacity: 1; }

/* ── 主题切换卡(浅/深双格,复用上面的 ✓ 角标)── */
.theme-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.theme-opt {
  --c: var(--glow); /* 给 .swatch-check 的 ✓ 上色 */
  position: relative;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px 8px;
  font-size: 12px; color: var(--text-dim);
  background: transparent; border: 1px solid var(--border); border-radius: 8px;
  cursor: pointer;
}
.theme-opt:hover { border-color: var(--text-dim); }
.theme-opt.on { border-color: var(--glow); color: var(--text); background: rgba(var(--glow-rgb),0.06); }
.theme-chip { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--border); box-sizing: border-box; }
.theme-chip.light { background: linear-gradient(135deg, #ffffff 50%, #eceef1 50%); }
.theme-chip.dark { background: linear-gradient(135deg, #131316 50%, #09090b 50%); }
/* 迷你终端图标:整块预设色背景 + 白色 '</>',还原 favicon 造型 */
.icon-chip {
  display: inline-flex; align-items: center; justify-content: center;
  width: 46px; height: 46px;
  font-family: var(--font, monospace); font-size: 15px; font-weight: 700;
  color: #fff;
  border-radius: 10px;
}
.swatch-label { font-size: 11px; color: var(--text-dim, #6b6b78); }
.swatch.on .swatch-label { color: var(--text, #c8c8d0); }
</style>
