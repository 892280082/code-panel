<script setup lang="ts">
// ── 云文件抽屉(☁):上传/下载 与宿主机换文件 ─────────────
//   上传 Tab:文件 → 上传目录;底部 Ctrl+V 粘贴图片即传(截图直接给);
//            图片出缩略图、点开放大;每行可「复制路径」= 复制绝对路径给终端/AI。
//   下载 Tab:AI/命令写到下载目录的文件,点「下载」拿回本地。
//   目录在 ⚙ 配置「文件」Tab 可改,默认 <项目根>/.code-panel/files/{uploads,downloads}。

import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { apiFetch } from '@/utils/api-fetch'
import { useCloudStore } from '@/stores/cloud'
import { useProjectsStore } from '@/stores/projects'
import { useAuthStore } from '@/stores/auth'

interface CloudFile {
  name: string; size: number; mtime: number; ext: string; image: boolean; abs: string
}

const cloud = useCloudStore()
const projects = useProjectsStore()
const auth = useAuthStore()

type Tab = 'upload' | 'download'
const tab = ref<Tab>('upload')
const uploads = ref<CloudFile[]>([])
const downloads = ref<CloudFile[]>([])
const dirUpload = ref('')
const dirDownload = ref('')
const busy = ref(false)
const tip = ref('')
const copied = ref('')      // 刚复制的文件名(按钮短暂变 ✓)
const uploadingMsg = ref('')

// 预览放大
const preview = ref<{ name: string; url: string } | null>(null)

const pid = () => projects.currentId

function rawUrl(name: string, side: Tab): string {
  const id = pid()
  if (!id) return ''
  return `/api/files/raw?project=${encodeURIComponent(id)}&side=${side}&name=${encodeURIComponent(name)}&token=${auth.token}`
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function setTip(m: string) { tip.value = m; setTimeout(() => { if (tip.value === m) tip.value = '' }, 3000) }

async function load(side: Tab) {
  const id = pid()
  if (!id) return
  try {
    const res = await apiFetch(`/api/files?project=${encodeURIComponent(id)}&side=${side}`)
    const data = await res.json()
    if (data?.ok) {
      if (side === 'upload') { uploads.value = data.data.files || []; dirUpload.value = data.data.dir || '' }
      else { downloads.value = data.data.files || []; dirDownload.value = data.data.dir || '' }
    }
  } catch { /* 静默 */ }
}

// ── 上传文件(选择)────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
function onPickFiles() { fileInput.value?.click() }
async function onFilesChosen(e: Event) {
  const el = e.target as HTMLInputElement
  const files = Array.from(el.files || [])
  el.value = ''
  await doUpload(files)
}

async function doUpload(files: File[]) {
  const id = pid()
  if (!id || !files.length) return
  busy.value = true
  uploadingMsg.value = files.length > 1 ? `上传 ${files.length} 个文件…` : `上传 ${files[0].name}…`
  try {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    const res = await apiFetch(`/api/files/upload?project=${encodeURIComponent(id)}`, { method: 'POST', body: fd })
    const data = await res.json()
    if (data?.ok) { setTip(`✓ 已上传 ${data.data.uploaded?.length || files.length} 个`); load('upload') }
    else setTip(data?.error || '上传失败')
  } catch {
    setTip('上传失败(网络)')
  } finally {
    busy.value = false
    uploadingMsg.value = ''
  }
}

// ── 剪贴板粘贴:图片 → base64 上传;其它文件 → 直接传 ──
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const fileItem = Array.from(items).find((it) => it.kind === 'file')
  if (!fileItem) return
  e.preventDefault()
  const f = fileItem.getAsFile()
  if (!f) return
  if (f.type.startsWith('image/')) sendPasteImage(f)
  else doUpload([f])
}

function sendPasteImage(f: File) {
  const id = pid()
  if (!id) return
  busy.value = true
  uploadingMsg.value = '粘贴图片上传中…'
  const r = new FileReader()
  r.onload = async () => {
    try {
      const res = await apiFetch(`/api/files/paste-image?project=${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: r.result }),
      })
      const data = await res.json()
      if (data?.ok) { setTip(`✓ 已上传 ${data.data.name}`); load('upload') }
      else setTip(data?.error || '上传失败')
    } catch {
      setTip('上传失败(网络)')
    } finally {
      busy.value = false
      uploadingMsg.value = ''
    }
  }
  r.onerror = () => { busy.value = false; uploadingMsg.value = ''; setTip('读取剪贴板失败') }
  r.readAsDataURL(f)
}

// ── 复制绝对路径 ────────────────────────────────────────
async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true } catch { /* fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = t; document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}
async function copyPath(f: CloudFile) {
  if (await copyText(f.abs)) {
    copied.value = f.name
    setTimeout(() => { if (copied.value === f.name) copied.value = '' }, 1600)
  }
}

// 顶部「复制整个目录」按钮(告诉终端/AI 往哪写 / 在哪取)
const copiedDir = ref<Tab | ''>('')
async function copyDir(side: Tab) {
  const p = side === 'upload' ? dirUpload.value : dirDownload.value
  if (!p) return
  if (await copyText(p)) {
    copiedDir.value = side
    setTimeout(() => { if (copiedDir.value === side) copiedDir.value = '' }, 1600)
  }
}

// ── 下载(AI 写的文件)→ 浏览器拿回本地 ─────────────────
async function downloadFile(f: CloudFile) {
  try {
    const res = await apiFetch(rawUrl(f.name, 'download'))
    if (!res.ok) { setTip('下载失败'); return }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = f.name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  } catch {
    setTip('下载失败(网络)')
  }
}

// ── 切换 Tab / 打开时刷新 ──────────────────────────────
watch(() => cloud.isOpen, (o) => { if (o) { tab.value = 'upload'; load('upload'); load('download') } })
function switchTab(t: Tab) { tab.value = t; load(t) }
watch(() => projects.currentId, () => { if (cloud.isOpen) { load('upload'); load('download') } })

// 点击别处关闭
function onDocMouseDown(e: MouseEvent) {
  if (!cloud.isOpen) return
  const el = e.target as HTMLElement
  if (el.closest('.cloud-drawer')) return
  cloud.close()
}
onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

function openPreview(f: CloudFile) {
  preview.value = { name: f.name, url: rawUrl(f.name, 'upload') }
}
</script>

<template>
  <Teleport to="body">
    <!-- 预览放大 -->
    <div v-if="preview" class="prev-backdrop" @click="preview = null">
      <div class="prev-box" @click.stop>
        <div class="prev-head">
          <span class="prev-name">{{ preview.name }}</span>
          <button class="prev-close" @click="preview = null">✕</button>
        </div>
        <img class="prev-img" :src="preview.url" alt="" />
      </div>
    </div>

    <div v-if="cloud.isOpen" class="cloud-backdrop" />
    <div v-if="cloud.isOpen" class="cloud-drawer">
      <!-- 头部 -->
      <div class="cloud-header">
        <span class="cloud-title">☁ 云文件</span>
        <span v-if="tip" class="cloud-tip">{{ tip }}</span>
        <button class="cloud-refresh" title="刷新当前列表" @click="load(tab)">↻</button>
        <button class="cloud-close" title="关闭" @click="cloud.close()">✕</button>
      </div>

      <!-- 项目提示 -->
      <div v-if="!projects.currentProject" class="cloud-noproj">
        先选一个项目(⚙ 配置 → 项目)。上传/下载目录默认在项目 <code>.code-panel/uploads</code> 和 <code>downloads</code>,可在 ⚙ 配置 →「文件」改。
      </div>

      <template v-else>
        <!-- Tab -->
        <div class="cloud-tabs">
          <button class="cloud-tab" :class="{ on: tab === 'upload' }" @click="switchTab('upload')">⬆ 上传</button>
          <button class="cloud-tab" :class="{ on: tab === 'download' }" @click="switchTab('download')">⬇ 下载</button>
        </div>

        <!-- 列表 -->
        <div class="cloud-body">
          <!-- 顶部:整个目录的用途提示 + 一键复制路径(复制给终端/AI) -->
          <div class="cloud-diralert">
            <span class="cloud-dirico">📁</span>
            <div class="cloud-dirinfo">
              <div class="cloud-dirlabel">{{ tab === 'upload' ? '上传目录 · 文件传到这里' : '下载目录 · 复制路径发给终端/AI,让它往这里写文档/文件' }}</div>
              <div class="cloud-dirpath" :title="tab === 'upload' ? dirUpload : dirDownload">{{ tab === 'upload' ? dirUpload : dirDownload }}</div>
            </div>
            <button class="cloud-dircopy" :class="{ ok: copiedDir === tab }" title="复制整个目录的绝对路径" @click="copyDir(tab)">
              {{ copiedDir === tab ? '✓ 已复制' : '复制目录' }}
            </button>
          </div>

          <div v-if="busy" class="cloud-busy">{{ uploadingMsg || '处理中…' }}</div>

          <!-- 上传 Tab -->
          <template v-if="tab === 'upload'">
            <div v-if="!uploads.length" class="cloud-empty">
              还没有上传。点下方粘贴图片 / 选择文件,上传后复制绝对路径给终端或 AI。
            </div>
            <div v-for="f in uploads" :key="f.name" class="f-row">
              <div class="f-thumb" @click="f.image && openPreview(f)">
                <img v-if="f.image" :src="rawUrl(f.name, 'upload')" loading="lazy" alt="" />
                <span v-else class="f-ico">📄</span>
              </div>
              <div class="f-main">
                <div class="f-name" :title="f.name">{{ f.name }}</div>
                <div class="f-meta">{{ fmtSize(f.size) }} · {{ fmtTime(f.mtime) }}</div>
              </div>
              <button class="f-copy" :class="{ ok: copied === f.name }" title="复制绝对路径到剪贴板" @click="copyPath(f)">
                {{ copied === f.name ? '✓ 已复制' : '复制路径' }}
              </button>
            </div>
          </template>

          <!-- 下载 Tab -->
          <template v-else>
            <div v-if="!downloads.length" class="cloud-empty">下载目录暂时是空的。AI 写完文件后点一下「↻」刷新,就能下载。</div>
            <div v-for="f in downloads" :key="f.name" class="f-row">
              <div class="f-thumb" @click="f.image && (preview = { name: f.name, url: rawUrl(f.name, 'download') })">
                <img v-if="f.image" :src="rawUrl(f.name, 'download')" loading="lazy" alt="" />
                <span v-else class="f-ico">📄</span>
              </div>
              <div class="f-main">
                <div class="f-name" :title="f.name">{{ f.name }}</div>
                <div class="f-meta">{{ fmtSize(f.size) }} · {{ fmtTime(f.mtime) }}</div>
              </div>
              <div class="f-acts">
                <button class="f-copy" title="复制绝对路径" @click="copyPath(f)">{{ copied === f.name ? '✓' : '复制' }}</button>
                <button class="f-dl" title="下载到本地" @click="downloadFile(f)">下载</button>
              </div>
            </div>
          </template>
        </div>

        <!-- 底部输入条:仅上传 Tab -->
        <div v-if="tab === 'upload'" class="cloud-inputbar">
          <input ref="fileInput" type="file" multiple hidden @change="onFilesChosen" />
          <button class="pick-btn" @click="onPickFiles">＋ 文件</button>
          <input
            class="paste-input mono"
            placeholder="Ctrl+V 粘贴图片(截图直接传)"
            @paste="onPaste"
            spellcheck="false"
          />
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* 预览放大 */
.prev-backdrop {
  position: fixed; inset: 0; z-index: 30000;
  background: rgba(0,0,0,0.78);
  display: flex; align-items: center; justify-content: center;
}
.prev-box {
  background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a);
  border-radius: 10px;
  max-width: 90vw; max-height: 90vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.prev-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--border, #23232a);
}
.prev-name { font-size: 12px; color: var(--text, #c8c8d0); font-family: var(--font, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prev-close { background: transparent; border: none; color: var(--text-dim, #6b6b78); font-size: 16px; cursor: pointer; }
.prev-close:hover { color: #f44747; }
.prev-img { max-width: 90vw; max-height: calc(90vh - 44px); object-fit: contain; }

/* 抽屉壳 */
.cloud-backdrop {
  position: fixed; inset: 0; z-index: 11000;
  background: rgba(0,0,0,0.3);
}
.cloud-drawer {
  position: fixed; top: 0; right: 0;
  width: 460px; height: 100vh; z-index: 11001;
  background: var(--surface, #131316);
  border-left: 1px solid var(--border, #23232a);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 16px rgba(0,0,0,0.3);
  animation: cloudIn 0.2s ease;
}
@keyframes cloudIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

.cloud-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-bottom: 1px solid var(--border, #23232a);
  flex-shrink: 0;
}
.cloud-title { font-size: 14px; font-weight: 600; color: var(--text, #c8c8d0); }
.cloud-tip { flex: 1; text-align: right; font-size: 11px; color: var(--glow, #22ee66); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cloud-refresh {
  flex-shrink: 0; background: transparent; border: 1px solid var(--border, #23232a);
  color: var(--text-dim, #6b6b78); cursor: pointer; font-size: 13px;
  width: 26px; height: 26px; border-radius: 5px; line-height: 1;
}
.cloud-refresh:hover { color: var(--glow, #22ee66); border-color: var(--glow-dim, rgba(34,238,102,0.3)); }
.cloud-close { background: transparent; border: none; color: var(--text-dim, #6b6b78); cursor: pointer; font-size: 16px; flex-shrink: 0; }
.cloud-close:hover { color: #f44747; }

.cloud-noproj {
  padding: 16px; color: var(--text-dim, #6b6b78); font-size: 12px; line-height: 1.8;
  display: flex; flex-direction: column;
}
.cloud-noproj code { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.05); border-radius: 3px; padding: 0 4px; }

.cloud-tabs { display: flex; border-bottom: 1px solid var(--border, #23232a); flex-shrink: 0; }
.cloud-tab {
  flex: 1; padding: 8px 0; border: none; background: transparent;
  color: var(--text-dim, #6b6b78); font-size: 13px; cursor: pointer;
  border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s;
}
.cloud-tab.on { color: var(--glow, #22ee66); border-bottom-color: var(--glow, #22ee66); }
.cloud-tab:not(.on):hover { color: var(--text, #c8c8d0); }

.cloud-body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.cloud-empty { color: var(--text-dim, #6b6b78); font-size: 12px; text-align: center; padding: 24px 8px; line-height: 1.9; }
.cloud-empty code { color: var(--text, #c8c8d0); background: rgba(255,255,255,0.05); border-radius: 3px; padding: 0 4px; font-family: var(--font, monospace); }
.cloud-busy { color: var(--glow, #22ee66); font-size: 12px; text-align: center; padding: 8px 0; }

/* 顶部:整目录提示 + 一键复制 */
.cloud-diralert {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: rgba(68,153,238,0.08);
  border: 1px solid rgba(68,153,238,0.28);
  border-radius: 8px;
  flex-shrink: 0;
}
.cloud-dirico { font-size: 14px; flex-shrink: 0; }
.cloud-dirinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cloud-dirlabel { font-size: 10px; color: var(--text, #c8c8d0); }
.cloud-dirpath { font-size: 10px; color: #8ab4f8; font-family: var(--font, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cloud-dircopy {
  flex-shrink: 0; padding: 5px 10px; font-size: 11px; border-radius: 5px; cursor: pointer;
  background: rgba(68,153,238,0.12); color: #8ab4f8;
  border: 1px solid rgba(68,153,238,0.35); white-space: nowrap;
  transition: background 0.15s;
}
.cloud-dircopy:hover { background: rgba(68,153,238,0.22); }
.cloud-dircopy.ok { background: rgba(34,238,102,0.15); color: var(--glow, #22ee66); border-color: var(--glow-dim, rgba(34,238,102,0.4)); }

/* 文件行 */
.f-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 8px; padding: 6px 8px;
  transition: border-color 0.15s;
}
.f-row:hover { border-color: var(--text-dim, #6b6b78); }
.f-thumb {
  width: 44px; height: 44px; border-radius: 6px; flex-shrink: 0;
  background: rgba(0,0,0,0.25); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  cursor: zoom-in;
}
.f-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.f-thumb .f-ico { font-size: 20px; }
.f-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.f-name { font-size: 12px; color: var(--text, #c8c8d0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font, monospace); }
.f-meta { font-size: 10px; color: var(--text-dim, #6b6b78); }
.f-acts { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.f-copy, .f-dl {
  padding: 4px 10px; font-size: 11px; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--glow, #22ee66);
  border: 1px solid var(--glow-dim, rgba(34,238,102,0.3)); white-space: nowrap;
}
.f-copy.ok { background: rgba(34,238,102,0.15); }
.f-copy:hover, .f-dl:hover { background: rgba(34,238,102,0.12); }
.f-dl { color: var(--text, #c8c8d0); border-color: var(--border, #23232a); }
.f-dl:hover { border-color: var(--glow-dim, rgba(34,238,102,0.3)); }

/* 底部输入条 */
.cloud-inputbar {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px; border-top: 1px solid var(--border, #23232a);
  flex-shrink: 0; background: var(--bg, #09090b);
}
.pick-btn {
  flex-shrink: 0; padding: 7px 12px; font-size: 12px; cursor: pointer;
  background: transparent; color: var(--glow, #22ee66);
  border: 1px dashed var(--glow-dim, rgba(34,238,102,0.4)); border-radius: 6px;
  transition: background 0.15s;
}
.pick-btn:hover { background: rgba(34,238,102,0.08); }
.paste-input {
  flex: 1; min-width: 0;
  padding: 7px 10px; font-size: 12px; border-radius: 6px; outline: none;
  background: var(--surface, #131316); color: var(--text, #c8c8d0);
  border: 1px solid var(--border, #23232a);
  transition: border-color 0.15s;
}
.paste-input:focus { border-color: var(--glow, #22ee66); }
.paste-input::placeholder { color: var(--text-dim, #6b6b78); }
</style>
