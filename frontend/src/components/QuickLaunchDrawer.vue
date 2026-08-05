<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useLogStore } from '@/stores/logs'

const logStore = useLogStore()
const open = ref(false)
const links = ref<any[]>([])
const showForm = ref(false)
const newLabel = ref('')
const newUrl = ref('')
const newTag = ref('')
const formError = ref('')

/** 当前日志分组 key */
const currentGroup = computed(() => logStore.currentGroup || '')
/** 当前分组显示名称 */
const groupLabel = computed(() => {
  const g = logStore.groupNames[currentGroup.value]
  return g?.name || currentGroup.value || '全局'
})

/** 补全链接协议:无 scheme 时默认 https,以 / 开头的相对路径原样保留 */
function normalizeUrl(url: string): string {
  const s = url.trim()
  if (s.startsWith('/')) return s
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s
  return 'https://' + s
}

async function loadLinks() {
  try {
    const group = currentGroup.value
    const url = group ? `/api/launch/links?group=${encodeURIComponent(group)}` : '/api/launch/links'
    const res = await fetch(url)
    const data = await res.json()
    if (data.ok) links.value = data.data
  } catch { /* ignore */ }
}

function toggle() {
  open.value = !open.value
  if (open.value) loadLinks()
}

// 分组切换时重新加载
watch(currentGroup, () => {
  if (open.value) loadLinks()
})

/** 点击卡片 → 新标签页打开 */
function onClickLink(link: any) {
  window.open(normalizeUrl(link.url), '_blank')
}

// ── 新建 ─────────────────────────────────────────────
async function handleCreate() {
  formError.value = ''
  if (!newLabel.value.trim()) { formError.value = '请输入名称'; return }
  if (!newUrl.value.trim()) { formError.value = '请输入链接'; return }
  try {
    const res = await fetch('/api/launch/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newLabel.value.trim(),
        url: newUrl.value.trim(),
        tag: newTag.value.trim() || undefined,
        group: currentGroup.value || undefined
      })
    })
    const data = await res.json()
    if (data.ok) {
      newLabel.value = ''; newUrl.value = ''; newTag.value = ''
      showForm.value = false
      loadLinks()
    } else {
      formError.value = data.error || '创建失败'
    }
  } catch {
    formError.value = '网络错误'
  }
}

// ── 编辑弹窗 ──────────────────────────────────────────
const editingLink = ref<any>(null)
const editLabel = ref('')
const editUrl = ref('')
const editTag = ref('')
const editError = ref('')

function openEdit(link: any) {
  editingLink.value = link
  editLabel.value = link.label
  editUrl.value = link.url
  editTag.value = link.tag || ''
  editError.value = ''
}

async function handleEditSave() {
  editError.value = ''
  if (!editLabel.value.trim()) { editError.value = '请输入名称'; return }
  if (!editUrl.value.trim()) { editError.value = '请输入链接'; return }
  try {
    const res = await fetch(`/api/launch/links/${editingLink.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: editLabel.value.trim(),
        url: editUrl.value.trim(),
        tag: editTag.value.trim() || undefined,
        group: currentGroup.value || undefined
      })
    })
    const data = await res.json()
    if (data.ok) {
      editingLink.value = null
      loadLinks()
    } else {
      editError.value = data.error || '编辑失败'
    }
  } catch {
    editError.value = '网络错误'
  }
}

// ── 删除 ──────────────────────────────────────────────
async function handleDelete(link: any) {
  if (!confirm(`确定删除「${link.label}」?`)) return false
  await fetch(`/api/launch/links/${link.id}`, { method: 'DELETE' })
  loadLinks()
  return true
}

// ── 排序 ──────────────────────────────────────────────
function moveUp(index: number) {
  if (index <= 0) return
  const ids = links.value.map((l: any) => l.id)
  const tmp = ids[index]; ids[index] = ids[index - 1]; ids[index - 1] = tmp
  saveReorder(ids)
}
function moveDown(index: number) {
  if (index >= links.value.length - 1) return
  const ids = links.value.map((l: any) => l.id)
  const tmp = ids[index]; ids[index] = ids[index + 1]; ids[index + 1] = tmp
  saveReorder(ids)
}
async function saveReorder(ids: string[]) {
  await fetch('/api/launch/links/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, group: currentGroup.value || undefined })
  })
  loadLinks()
}

// 关闭抽屉时清理表单
watch(open, (o) => { if (!o) { showForm.value = false; editingLink.value = null } })
</script>

<template>
  <div class="launch-root">
    <button
      class="launch-trigger"
      :class="{ on: open }"
      :title="open ? '关闭快捷启动' : '快捷启动'"
      @click="toggle"
    >
      ⚡ 快捷启动
    </button>

    <Teleport to="body">
      <div v-if="open" class="drawer-backdrop" @click="open = false" />
      <div v-if="open" class="drawer-panel" @click.stop>
        <!-- 固定头部 -->
        <div class="drawer-header">
          <span class="drawer-title">快捷启动 · {{ groupLabel }}</span>
          <button class="drawer-close" @click="open = false">✕</button>
        </div>

        <!-- 滚动内容区 -->
        <div class="drawer-scroll">
          <div v-if="links.length === 0 && !showForm" class="section-hint">
            暂无快捷链接,点击「+ 新建」创建
          </div>

          <div v-for="(link, idx) in links" :key="link.id" class="link-card">
            <div class="link-card-body" @click="onClickLink(link)">
              <div class="link-title">
                <span class="link-label">{{ link.label }}</span>
              </div>
              <span class="link-url">{{ link.url }}</span>
              <span v-if="link.tag" class="link-tag">{{ link.tag }}</span>
            </div>
            <div class="link-card-foot">
              <button class="foot-btn" :disabled="idx === 0" @click.stop="moveUp(idx)">▲</button>
              <button class="foot-btn" :disabled="idx === links.length - 1" @click.stop="moveDown(idx)">▼</button>
              <span class="foot-sep" />
              <button class="foot-btn cfg" @click.stop="openEdit(link)">配置</button>
            </div>
          </div>

          <!-- 底部:新建 -->
          <button class="new-btn" @click="showForm = !showForm">
            <span v-if="showForm">− 取消</span>
            <span v-else>+ 新建</span>
          </button>

          <div v-if="showForm" class="form-card">
            <input v-model="newLabel" class="form-input" placeholder="名称" @keyup.enter="handleCreate" />
            <input v-model="newUrl" class="form-input mono" placeholder="链接,如 localhost:5173 或 /terminal" @keyup.enter="handleCreate" />
            <input v-model="newTag" class="form-input" placeholder="标识(可选),如 分组/账号/平台" @keyup.enter="handleCreate" />
            <div v-if="formError" class="form-error">{{ formError }}</div>
            <button class="form-submit" @click="handleCreate">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 配置弹窗(编辑 + 删除) -->
    <Teleport to="body">
      <div v-if="editingLink" class="modal-backdrop" @click="editingLink = null" />
      <div v-if="editingLink" class="modal-dialog" @click.stop>
        <div class="modal-header">
          <span>配置快捷链接</span>
          <button class="modal-close" @click="editingLink = null">✕</button>
        </div>
        <div class="modal-body">
          <input v-model="editLabel" class="form-input" placeholder="名称" />
          <input v-model="editUrl" class="form-input mono" placeholder="链接" />
          <input v-model="editTag" class="form-input" placeholder="标识(可选),如 分组/账号/平台" />
          <div v-if="editError" class="form-error">{{ editError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn-danger" @click="handleDelete(editingLink).then(ok => { if (ok) editingLink = null })">删除</button>
          <span class="foot-gap" />
          <button class="btn-cancel" @click="editingLink = null">取消</button>
          <button class="btn-save" @click="handleEditSave">保存</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Toolbar 触发按钮 ────────────────────────────────── */
.launch-trigger {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
  white-space: nowrap;
}
.launch-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.launch-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

/* ── 抽屉 ─────────────────────────────────────────────── */
.drawer-backdrop {
  position: fixed; inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.3);
}
.drawer-panel {
  position: fixed;
  top: 0; right: 0;
  width: 320px; height: 100vh;
  z-index: 10001;
  background: var(--surface, #131316);
  border-left: 1px solid var(--border, #23232a);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 16px rgba(0,0,0,0.3);
  animation: slideIn 0.2s ease;
}
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

/* ── 固定头部 ─────────────────────────────────────────── */
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
}
.drawer-title { font-size: 14px; font-weight: 600; color: var(--text, #c8c8d0); }
.drawer-close { background: transparent; border: none; color: var(--text-dim, #6b6b78); cursor: pointer; font-size: 16px; }
.drawer-close:hover { color: #f44747; }

/* ── 滚动内容区 ────────────────────────────────────────── */
.drawer-scroll {
  flex: 1; overflow-y: auto;
  padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}

/* ── 新建按钮 ─────────────────────────────────────────── */
.new-btn {
  width: 100%; padding: 8px;
  border: 1px dashed var(--border, #23232a);
  border-radius: 6px;
  background: transparent;
  color: var(--glow, #22ee66);
  font-size: 13px; cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.new-btn:hover {
  border-color: var(--glow, #22ee66);
  background: rgba(34,238,102,0.05);
}

/* ── 新建表单 ─────────────────────────────────────────── */
.form-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
}
.form-input {
  padding: 8px 10px;
  border: 1px solid var(--border, #23232a);
  border-radius: 4px;
  background: var(--surface, #131316);
  color: var(--text, #c8c8d0);
  font-size: 12px;
  outline: none;
}
.form-input:focus { border-color: var(--glow, #22ee66); }
.form-input.mono { font-family: var(--font, monospace); }
.form-error {
  color: #f44747; font-size: 11px;
}
.form-submit {
  padding: 8px;
  border: none; border-radius: 4px;
  background: var(--glow, #22ee66);
  color: #09090b; font-size: 13px; cursor: pointer;
  font-weight: 600;
  transition: opacity 0.2s;
}
.form-submit:hover { opacity: 0.85; }

/* ── 链接卡片 ─────────────────────────────────────────── */
.link-card {
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.15s;
  flex-shrink: 0;
  min-height: 72px;
  display: flex; flex-direction: column;
}
.link-card:hover { border-color: rgba(34,238,102,0.3); }
.link-card-body {
  flex: 1; padding: 10px 12px 8px;
  cursor: pointer;
  overflow: hidden;
  display: flex; flex-direction: column; gap: 4px;
  position: relative;
}
.link-card-body:hover { background: rgba(34,238,102,0.03); }
.link-card-foot {
  display: flex; align-items: center; gap: 2px;
  padding: 4px 6px;
  border-top: 1px solid var(--border, #23232a);
  background: rgba(0,0,0,0.15);
}
.foot-btn {
  padding: 2px 8px;
  border: none; background: transparent;
  color: var(--text-dim, #6b6b78);
  font-size: 10px; cursor: pointer; border-radius: 3px;
  transition: color 0.15s, background 0.15s;
}
.foot-btn:hover:not(:disabled) { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.05); }
.foot-btn:disabled { opacity: 0.25; cursor: default; }
.foot-btn.cfg:hover { color: var(--glow, #22ee66); }
.foot-sep { width: 1px; height: 12px; background: var(--border, #23232a); margin: 0 2px; }

/* ── 编辑弹窗 ─────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0;
  z-index: 20000;
  background: rgba(0,0,0,0.5);
}
.modal-dialog {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20001;
  width: 360px; max-width: calc(100vw - 32px);
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #23232a);
  font-size: 14px; font-weight: 600; color: var(--text, #c8c8d0);
}
.modal-close {
  background: transparent; border: none;
  color: var(--text-dim, #6b6b78);
  cursor: pointer; font-size: 16px;
}
.modal-close:hover { color: #f44747; }
.modal-body {
  padding: 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border, #23232a);
}
.btn-cancel {
  padding: 8px 16px;
  border: 1px solid var(--border, #23232a);
  border-radius: 4px;
  background: transparent;
  color: var(--text-dim, #6b6b78);
  cursor: pointer; font-size: 13px;
}
.btn-cancel:hover { color: var(--text, #c8c8d0); }
.btn-save {
  padding: 8px 20px;
  border: none; border-radius: 4px;
  background: var(--glow, #22ee66);
  color: #09090b; cursor: pointer; font-size: 13px; font-weight: 600;
}
.btn-save:hover { opacity: 0.85; }
.btn-danger {
  padding: 8px 16px;
  border: 1px solid rgba(255,68,68,0.3);
  border-radius: 4px;
  background: transparent;
  color: #f44747;
  cursor: pointer; font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.btn-danger:hover { background: rgba(255,68,68,0.1); border-color: #f44747; }
.foot-gap { flex: 1; }

/* ── 通用 ─────────────────────────────────────────────── */
.section-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 12px; text-align: center; padding: 16px 0;
}
.link-title {
  overflow: hidden;
  padding-right: 56px;  /* 给右上角标识留空间,避免长名称重叠 */
}
.link-label { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-tag {
  position: absolute;
  top: 8px; right: 10px;
  font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 3px;
  background: rgba(34,238,102,0.08);
  color: var(--glow, #22ee66);
  border: 1px solid var(--glow-dim, rgba(34,238,102,0.3));
  white-space: nowrap;
}
.link-url {
  font-size: 11px; color: var(--text-dim, #6b6b78);
  font-family: var(--font, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
