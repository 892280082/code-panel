<script setup lang="ts">
// ── 快捷方式 / Quick Links(Tab 式)────────────────────────
//   分组显示为顶部 Tab,点哪个看哪个;默认/选中组记住在浏览器本地。
//   内容来自项目 .code-panel/links.yaml,纯展示 + 新标签打开。

import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { apiFetch } from '@/utils/api-fetch'
import { useProjectsStore } from '@/stores/projects'

interface LinkUrl { label?: string; url: string }
interface QuickItem { name: string; urls: LinkUrl[] }
interface QuickGroup { name: string; items: QuickItem[] }

const projects = useProjectsStore()

const open = ref(false)
const groups = ref<QuickGroup[]>([])
const query = ref('')
const active = ref('') // 当前选中的分组名
const triggerEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

/** 总条目数(触发按钮角标) */
const totalItems = computed(() =>
  groups.value.reduce((n, g) => n + (g.items?.length || 0), 0)
)

function activeKey() { return `ql:active:${projects.currentId || 'g'}` }
function loadActive() {
  try { active.value = localStorage.getItem(activeKey()) || '' } catch { active.value = '' }
}
function pick(name: string) {
  active.value = name
  try { localStorage.setItem(activeKey(), name) } catch { /* ignore */ }
}
/** 有内容则保证 active 落在某组(默认第一个) */
function ensureActive() {
  if (!groups.value.length) return
  if (!groups.value.some(g => g.name === active.value)) pick(groups.value[0].name)
}

/** 当前组过滤后的条目 */
const kw = computed(() => query.value.trim().toLowerCase())
const activeItems = computed<QuickItem[]>(() => {
  const g = groups.value.find(x => x.name === active.value)
  const items = (g?.items || []).filter(it => {
    if (!kw.value) return true
    if (it.name.toLowerCase().includes(kw.value)) return true
    const t = (it.urls || []).filter(u => u.url).map(u => `${u.label || ''} ${u.url}`.toLowerCase()).join(' ')
    return t.includes(kw.value)
  })
  return items
})

function normalize(url: string): string {
  const s = url.trim()
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s
  return 'http://' + s
}
function chipLabel(u: LinkUrl): string {
  return u.label && u.label.trim() ? u.label.trim() : u.url
}

async function load() {
  if (!projects.currentId) { groups.value = []; return }
  try {
    const res = await apiFetch(`/api/links?project=${encodeURIComponent(projects.currentId)}`)
    const data = await res.json()
    if (data.ok) groups.value = Array.isArray(data.data) ? data.data : []
    ensureActive()
  } catch { /* 静默 */ }
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    query.value = ''
    ensureActive()
    nextTick(() => positionPanel())
  }
}
function close() { open.value = false }

function positionPanel() {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 400
  const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
  panelStyle.value = { top: `${r.bottom + 6}px`, left: `${left}px` }
}

watch(() => projects.currentId, () => {
  groups.value = []
  loadActive()
  if (projects.currentId) load()
})

function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerEl.value?.contains(t)) return
  if (panelEl.value?.contains(t)) return
  close()
}

onMounted(() => {
  loadActive()
  load()
  document.addEventListener('mousedown', onDocMouseDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<template>
  <div ref="triggerEl" class="ql-root">
    <button
      class="ql-trigger"
      :class="{ on: open }"
      :title="open ? '关闭快捷方式' : '快捷方式(项目 .code-panel/links.yaml)'"
      @click="toggle"
    >🔗 快捷·{{ totalItems }}</button>

    <Teleport to="body">
      <div v-if="open" ref="panelEl" class="ql-panel" :style="panelStyle" @click.stop>
        <div class="ql-head">
          <span class="ql-title">快捷方式<template v-if="projects.currentProject"> · {{ projects.currentProject.name }}</template></span>
          <button class="ql-close" title="关闭" @click="close">✕</button>
        </div>

        <!-- 搜索框 -->
        <div class="ql-search">
          <span class="ql-search-ico">🔍</span>
          <input v-model="query" class="ql-input" placeholder="搜索标题 / 域名…" spellcheck="false" @keydown.esc="close" />
        </div>

        <!-- 分组 Tabs -->
        <div v-if="groups.length" class="ql-tabs">
          <button
            v-for="g in groups" :key="g.name"
            class="ql-tab" :class="{ on: active === g.name }"
            @click="pick(g.name)"
          >{{ g.name }}</button>
        </div>

        <div class="ql-body">
          <!-- 空配置 / 空分组 -->
          <div v-if="!groups.length" class="ql-hint">
            在项目 <code>.code-panel/links.yaml</code> 里添加快捷方式
          </div>
          <div v-else-if="activeItems.length === 0" class="ql-hint">无匹配</div>

          <!-- 当前分组内容 -->
          <template v-else>
            <div v-for="(it, ii) in activeItems" :key="ii" class="ql-item">
              <div class="ql-item-name">{{ it.name }}</div>
              <div v-if="it.urls && it.urls.length" class="ql-chips">
                <a
                  v-for="(u, ui) in it.urls.filter(u => u.url && u.url.trim())" :key="ui"
                  class="ql-chip" :href="normalize(u.url)" target="_blank" rel="noreferrer" :title="u.url"
                >{{ chipLabel(u) }}</a>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ql-root { display: inline-flex; }
.ql-trigger {
  font-family: var(--font); font-size: 10px;
  height: 26px; padding: 0 12px; box-sizing: border-box;
  display: inline-flex; align-items: center;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
  white-space: nowrap;
}
.ql-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.ql-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

.ql-panel {
  position: fixed; z-index: 12000;
  width: 400px; max-width: calc(100vw - 16px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45);
  display: flex; flex-direction: column; overflow: hidden;
}
.ql-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--border, #23232a); flex-shrink: 0;
}
.ql-title { font-size: 12px; font-weight: 600; color: var(--text, #c8c8d0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ql-close {
  background: transparent; border: none; color: var(--text-dim, #6b6b78);
  cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px;
}
.ql-close:hover { color: var(--danger, #f44747); background: rgba(244,71,71,0.1); }

.ql-search {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0; background: rgba(0,0,0,0.12);
}
.ql-search-ico { font-size: 11px; opacity: 0.7; }
.ql-input {
  flex: 1; min-width: 0;
  background: transparent; border: none; outline: none;
  color: var(--text, #c8c8d0);
  font-family: var(--font, monospace); font-size: 12px;
}
.ql-input::placeholder { color: var(--text-dim, #6b6b78); }

/* 分组 Tabs */
.ql-tabs {
  display: flex; gap: 2px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0; overflow-x: auto;
}
.ql-tab {
  padding: 6px 14px;
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: var(--text-dim, #6b6b78); font-size: 12px;
  cursor: pointer; white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.ql-tab:hover { color: var(--text, #c8c8d0); }
.ql-tab.on { color: var(--glow, #22ee66); border-bottom-color: var(--glow, #22ee66); }

.ql-body {
  flex: 1; overflow-y: auto;
  max-height: min(50vh, 420px);
  padding: 8px 12px 12px;
}
.ql-body::-webkit-scrollbar { width: 5px; }
.ql-body::-webkit-scrollbar-track { background: transparent; }
.ql-body::-webkit-scrollbar-thumb { background: var(--border, #23232a); border-radius: 3px; }

.ql-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 11px; text-align: center;
  padding: 22px 10px; line-height: 1.8;
}
.ql-hint code { background: rgba(255,255,255,0.05); border: 1px solid var(--border, #23232a); border-radius: 3px; padding: 0 4px; color: var(--text, #c8c8d0); }

.ql-item { padding: 8px 2px; }
.ql-item + .ql-item { border-top: 1px dashed rgba(255,255,255,0.05); }
.ql-item-name { font-size: 12px; font-weight: 500; color: var(--text, #c8c8d0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 5px; }
.ql-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ql-chip {
  display: inline-block; max-width: 100%;
  padding: 2px 9px;
  font-family: var(--font, monospace); font-size: 10px;
  color: var(--glow, #22ee66);
  background: rgba(34,238,102,0.06);
  border: 1px solid var(--glow-dim, rgba(34,238,102,0.3));
  border-radius: 10px;
  text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ql-chip:hover { color: #060; background: var(--glow, #22ee66); border-color: var(--glow, #22ee66); }
</style>
