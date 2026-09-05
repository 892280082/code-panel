<script setup lang="ts">
// ── 快捷方式 / Quick Links ─────────────────────────────────────────
//   展示项目 .code-panel/links.yaml 里提交的分组快捷链接(/log 顶栏 🔗 下拉)。
//   纯展示 + 新标签页打开;配置由手写 yaml 维护,面板不提供 CRUD。

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
const triggerEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

/** 总链接数(条目数):按钮上的 N */
const totalItems = computed(() =>
  groups.value.reduce((n, g) => n + (g.items?.length || 0), 0)
)

const kw = computed(() => query.value.trim().toLowerCase())

function urlTexts(it: QuickItem): string {
  return (it.urls || [])
    .filter(u => u.url && u.url.trim())
    .map(u => `${u.label || ''} ${u.url}`.toLowerCase())
    .join(' ')
}

function itemMatch(it: QuickItem): boolean {
  if (!kw.value) return true
  if (it.name.toLowerCase().includes(kw.value)) return true
  return urlTexts(it).includes(kw.value)
}

/** 过滤后仍保留的分组(空组隐藏) */
const filteredGroups = computed<QuickGroup[]>(() =>
  groups.value
    .map(g => ({ name: g.name, items: (g.items || []).filter(itemMatch) }))
    .filter(g => g.items.length > 0)
)

// ── 常用分组:浏览器本地勾选,高亮置顶,其余置灰 ──────────
function favKey() { return `ql:favs:${projects.currentId || 'g'}` }
const favs = ref<string[]>([])
function loadFavs() {
  try {
    const a = JSON.parse(localStorage.getItem(favKey()) || '[]')
    favs.value = Array.isArray(a) ? a.filter(x => typeof x === 'string') : []
  } catch { favs.value = [] }
}
function isFav(name: string): boolean { return favs.value.includes(name) }
function toggleFav(name: string) {
  if (isFav(name)) favs.value = favs.value.filter(x => x !== name)
  else favs.value = [...favs.value, name]
  try { localStorage.setItem(favKey(), JSON.stringify(favs.value)) } catch { /* ignore */ }
}

/** 展示顺序:勾选的常用组排前(按勾选顺序),其余照原序(置灰) */
const orderedGroups = computed<QuickGroup[]>(() => {
  const fg = filteredGroups.value
  return [...fg].sort((a, b) => {
    const ia = isFav(a.name) ? 1 : 0
    const ib = isFav(b.name) ? 1 : 0
    if (ia !== ib) return ib - ia
    if (ia && ib) return favs.value.indexOf(a.name) - favs.value.indexOf(b.name)
    return fg.indexOf(a) - fg.indexOf(b)
  })
})

/** 是否有任意条目(用于区分「空配置」与「搜索无结果」两种提示) */
const hasAnyItems = computed(() => totalItems.value > 0)

/** 打开时补 http:// 前缀:无 scheme 就当裸「主机 + 路径」处理 */
function normalize(url: string): string {
  const s = url.trim()
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s
  return 'http://' + s
}

/** 芯片文字:有 label 显示 label,否则显示 url 本身 */
function chipLabel(u: LinkUrl): string {
  return u.label && u.label.trim() ? u.label.trim() : u.url
}

async function load() {
  if (!projects.currentId) { groups.value = []; return }
  try {
    const res = await apiFetch(`/api/links?project=${encodeURIComponent(projects.currentId)}`)
    const data = await res.json()
    if (data.ok) groups.value = Array.isArray(data.data) ? data.data : []
  } catch { /* 网络错误静默,保持旧数据 */ }
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    query.value = ''
    nextTick(() => positionPanel())
  }
}
function close() { open.value = false }

/** 下拉面板锚定在触发按钮下方(贴左对齐;过宽则收进视口右侧) */
function positionPanel() {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 400
  const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
  panelStyle.value = { top: `${r.bottom + 6}px`, left: `${left}px` }
}

/** 项目切换时重新加载(含首次选中项目) */
watch(() => projects.currentId, () => {
  groups.value = []
  loadFavs()
  if (projects.currentId) load()
})

/** 点击面板/按钮之外 → 关闭 */
function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerEl.value?.contains(t)) return
  if (panelEl.value?.contains(t)) return
  close()
}

onMounted(() => {
  loadFavs()
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
    >
      🔗 快捷·{{ totalItems }}
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panelEl" class="ql-panel" :style="panelStyle" @click.stop>
        <div class="ql-head">
          <span class="ql-title">快捷方式<template v-if="projects.currentProject"> · {{ projects.currentProject.name }}</template></span>
          <button class="ql-close" title="关闭" @click="close">✕</button>
        </div>

        <div class="ql-search">
          <span class="ql-search-ico">🔍</span>
          <input
            v-model="query"
            class="ql-input"
            placeholder="搜索标题 / 域名…"
            spellcheck="false"
            @keydown.esc="close"
          />
        </div>

        <div class="ql-body">
          <!-- 空配置提示 -->
          <div v-if="!hasAnyItems" class="ql-hint">
            在项目 <code>.code-panel/links.yaml</code> 里添加快捷方式
          </div>
          <!-- 搜索无结果 -->
          <div v-else-if="filteredGroups.length === 0" class="ql-hint">无匹配</div>

          <!-- 分组 -->
          <template v-else>
            <section
              v-for="(g, gi) in orderedGroups" :key="gi"
              class="ql-group"
              :class="{ fav: isFav(g.name), dim: !isFav(g.name) }"
            >
              <div class="ql-group-head">
                <button
                  class="ql-fav" :class="{ on: isFav(g.name) }"
                  :title="isFav(g.name) ? '取消常用' : '设为常用(排前面+高亮)'"
                  @click.stop="toggleFav(g.name)"
                >{{ isFav(g.name) ? '★' : '☆' }}</button>
                <span class="ql-group-name">{{ g.name }}</span>
                <span class="ql-group-cnt">{{ g.items.length }}</span>
              </div>

              <div v-for="(it, ii) in g.items" :key="ii" class="ql-item">
                <div class="ql-item-name">{{ it.name }}</div>
                <div v-if="it.urls && it.urls.length" class="ql-chips">
                  <a
                    v-for="(u, ui) in it.urls.filter(u => u.url && u.url.trim())"
                    :key="ui"
                    class="ql-chip"
                    :href="normalize(u.url)"
                    target="_blank"
                    rel="noreferrer"
                    :title="u.url"
                  >{{ chipLabel(u) }}</a>
                </div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── 工具栏触发按钮(与 ⚡ 快捷启动 同一视觉) ─────────── */
.ql-root { display: inline-flex; }
.ql-trigger {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
  white-space: nowrap;
}
.ql-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.ql-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

/* ── 下拉面板(Teleport 到 body) ─────────────────────── */
.ql-panel {
  position: fixed;
  z-index: 12000;
  width: 400px;
  max-width: calc(100vw - 16px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 头部 ─────────────────────────────────────────────── */
.ql-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
}
.ql-title { font-size: 12px; font-weight: 600; color: var(--text, #c8c8d0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ql-close {
  background: transparent; border: none;
  color: var(--text-dim, #6b6b78); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px;
}
.ql-close:hover { color: var(--danger, #f44747); background: rgba(244,71,71,0.1); }

/* ── 搜索框 ───────────────────────────────────────────── */
.ql-search {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
  background: rgba(0,0,0,0.12);
}
.ql-search-ico { font-size: 11px; opacity: 0.7; }
.ql-input {
  flex: 1; min-width: 0;
  background: transparent; border: none; outline: none;
  color: var(--text, #c8c8d0);
  font-family: var(--font, monospace); font-size: 12px;
}
.ql-input::placeholder { color: var(--text-dim, #6b6b78); }

/* ── 滚动内容 ─────────────────────────────────────────── */
.ql-body {
  flex: 1;
  overflow-y: auto;
  max-height: min(58vh, 520px);
  padding: 8px 10px 12px;
}
.ql-body::-webkit-scrollbar { width: 5px; }
.ql-body::-webkit-scrollbar-track { background: transparent; }
.ql-body::-webkit-scrollbar-thumb { background: var(--border, #23232a); border-radius: 3px; }

/* ── 提示 ─────────────────────────────────────────────── */
.ql-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 11px; text-align: center;
  padding: 22px 10px; line-height: 1.8;
}
.ql-hint code {
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--border, #23232a);
  border-radius: 3px; padding: 0 4px;
  color: var(--text, #c8c8d0);
}

/* ── 分组 ─────────────────────────────────────────────── */
.ql-group { margin-top: 10px; }
.ql-group:first-child { margin-top: 2px; }
.ql-group-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text-dim, #6b6b78);
  text-transform: uppercase;
  padding: 2px 2px 6px;
  border-bottom: 1px solid var(--border, #23232a);
  margin-bottom: 4px;
}
.ql-group-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ql-group-cnt {
  font-size: 9px; color: var(--text-dim, #6b6b78);
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px; padding: 0 6px; line-height: 14px;
  flex-shrink: 0;
}

/* ── 条目 ─────────────────────────────────────────────── */
.ql-item {
  padding: 6px 2px;
}
.ql-item + .ql-item { border-top: 1px dashed rgba(255,255,255,0.04); }
.ql-item-name {
  font-size: 12px; font-weight: 500;
  color: var(--text, #c8c8d0);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-bottom: 4px;
}
.ql-chips {
  display: flex; flex-wrap: wrap; gap: 5px;
}
.ql-chip {
  display: inline-block;
  max-width: 100%;
  padding: 2px 9px;
  font-family: var(--font, monospace);
  font-size: 10px;
  color: var(--glow, #22ee66);
  background: rgba(34,238,102,0.06);
  border: 1px solid var(--glow-dim, rgba(34,238,102,0.3));
  border-radius: 10px;
  text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ql-chip:hover {
  color: #060; background: var(--glow, #22ee66);
  border-color: var(--glow, #22ee66);
}

/* ── 常用分组(勾选高亮置顶;其余置灰) ─────────────────── */
.ql-fav {
  background: transparent; border: none; cursor: pointer;
  font-size: 11px; line-height: 1; padding: 0 2px;
  color: var(--text-dim, #6b6b78);
}
.ql-fav.on { color: #f2cc60; text-shadow: 0 0 6px rgba(242,204,96,0.55); }
.ql-group.dim { opacity: 0.42; }
.ql-group.fav { }
.ql-group.fav .ql-group-head { border-bottom-color: rgba(242,204,96,0.35); }
.ql-group.fav .ql-group-name { color: #f2cc60; }
</style>
