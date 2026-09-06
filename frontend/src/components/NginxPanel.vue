<script setup lang="ts">
// ── nginx 检测面板(嵌入 ⚙ 配置 → nginx Tab)─────────────────
//   只读:本机 nginx 状态 + 项目 .code-panel/nginx 下 conf 列表/查看 + 「检测」按钮
//   (nginx -t 语法 / server_name 是否被本机加载 / 项目副本 vs 本机实际加载 md5)
import { apiFetch } from '@/utils/api-fetch'
import { ref, watch, onMounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'

const projects = useProjectsStore()

interface NginxInfo {
  bin: string
  version: string
  mainConf: string
  includeDirs: string[]
  masterPid: number | null
  running: boolean
}
interface ConfItem { name: string; abs: string; size: number; mtime: number }

const status = ref<NginxInfo | null>(null)
const statusMsg = ref('')
const confs = ref<ConfItem[]>([])
const dir = ref('')
const selected = ref('')
const content = ref('')
const busy = ref(false)
const checkResult = ref<any>(null)
const checkErr = ref('')

function qs() { return `project=${encodeURIComponent(projects.currentId || '')}` }

async function loadStatus() {
  statusMsg.value = ''
  try {
    const res = await apiFetch(`/api/nginx/status?${qs()}`)
    const data = await res.json()
    if (data?.ok) status.value = data.data
    else statusMsg.value = data?.error || '读取失败'
  } catch {
    statusMsg.value = '无法读取 nginx 状态'
  }
}

async function loadConfs() {
  confs.value = []
  selected.value = ''
  content.value = ''
  checkResult.value = null
  if (!projects.currentId) { dir.value = ''; return }
  try {
    const res = await apiFetch(`/api/nginx/confs?${qs()}`)
    const data = await res.json()
    if (data?.ok) {
      confs.value = data.data
      dir.value = data.data.length ? data.data[0].abs.replace(/[^/]+\.conf$/, '') : ''
    }
  } catch { /* ignore */ }
}

async function openConf(name: string) {
  selected.value = name
  content.value = ''
  checkResult.value = null
  if (!name) return
  try {
    const res = await apiFetch(`/api/nginx/conf?${qs()}&file=${encodeURIComponent(name)}`)
    const data = await res.json()
    if (data?.ok) content.value = data.data.content
  } catch { content.value = '' }
}

async function runCheck() {
  if (!selected.value || busy.value) return
  busy.value = true
  checkErr.value = ''
  checkResult.value = null
  try {
    const res = await apiFetch(`/api/nginx/check?${qs()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: selected.value }),
    })
    const data = await res.json()
    if (data?.ok) checkResult.value = data.data
    else checkErr.value = data?.error || '检测失败'
  } catch {
    checkErr.value = '网络错误'
  } finally {
    busy.value = false
  }
}

function loadAll() {
  if (!projects.currentId) return
  loadStatus()
  loadConfs()
}
watch(() => projects.currentId, () => { if (projects.currentId) loadAll() })
onMounted(loadAll)

const loadedLabel = (loaded: string) => {
  if (loaded === 'loaded') return { text: '✅ 已加载', cls: 'ok' }
  if (loaded === 'missing') return { text: '⚠️ 本机 nginx 未加载该 server_name', cls: 'warn' }
  if (loaded === 'nginx-down') return { text: '⛔ nginx 未运行', cls: 'err' }
  return { text: '— conf 无 server_name', cls: 'dim' }
}
</script>

<template>
  <div class="nginx-panel">
    <div v-if="!projects.currentProject" class="hint">先选一个项目,再检测它的 nginx 配置。</div>
    <template v-else>
      <!-- ── nginx 状态卡 ── -->
      <div class="stat-card">
        <div class="stat-title">本机 nginx 状态<span class="sub">(code-panel 运行所在机器)</span></div>
        <div class="stat-grid">
          <div class="stat"><span class="k">进程</span><span class="v" :class="status?.running ? 'ok' : 'err'">{{ status?.running ? '运行中' : '未运行' }}</span></div>
          <div class="stat"><span class="k">版本</span><span class="v">{{ status?.version || '—' }}</span></div>
          <div class="stat"><span class="k">bin</span><span class="v mono">{{ status?.bin || '—' }}</span></div>
          <div class="stat"><span class="k">主 conf</span><span class="v mono">{{ status?.mainConf || '—' }}</span></div>
          <div class="stat wide"><span class="k">include 目录</span><span class="v mono">{{ status?.includeDirs?.join(' , ') || '—' }}</span></div>
        </div>
        <div v-if="statusMsg" class="err">{{ statusMsg }}</div>
        <div v-if="!status?.running" class="warn-line">nginx 未运行 → 无法判断 conf 是否被加载。</div>
      </div>

      <!-- ── conf 源目录 + 文件列表 + 查看/检测 ── -->
      <div class="conf-card">
        <div class="conf-title">
          <span>conf 源目录</span>
          <span class="sub mono">{{ dir || '.code-panel/nginx/' }}</span>
        </div>
        <div class="conf-body">
          <!-- 左:文件列表 -->
          <div class="conf-list">
            <div v-if="confs.length === 0" class="hint">项目 .code-panel/nginx/ 下暂无 .conf</div>
            <div
              v-for="c in confs" :key="c.name"
              class="conf-item" :class="{ on: selected === c.name }"
              @click="openConf(c.name)"
            >{{ c.name }}</div>
          </div>
          <!-- 右:内容 + 检测 -->
          <div class="conf-main">
            <div class="conf-actions">
              <span class="cur-file">{{ selected || '未选择 conf' }}</span>
              <button class="chk-btn" :disabled="!selected || busy" @click="runCheck">
                {{ busy ? '检测中…' : '🔎 检测(加载/生效)' }}
              </button>
            </div>
            <textarea v-if="content" v-model="content" readonly spellcheck="false" class="conf-text mono"></textarea>
            <div v-else class="hint">选中左侧 conf 查看内容</div>

            <!-- 检测结果 -->
            <div v-if="checkErr" class="err">{{ checkErr }}</div>
            <div v-if="checkResult" class="chk-result">
              <div class="res-line">
                <span class="res-k">server_name</span>
                <span class="res-v mono">{{ checkResult.serverName || '—' }}</span>
              </div>
              <div class="res-line">
                <span class="res-k">加载状态</span>
                <span class="res-v" :class="loadedLabel(checkResult.loaded).cls">{{ loadedLabel(checkResult.loaded).text }}</span>
              </div>
              <div class="res-line">
                <span class="res-k">nginx -t 语法</span>
                <span class="res-v" :class="checkResult.syntax.ok ? 'ok' : 'err'">
                  {{ checkResult.syntax.ok ? '✅ 通过' : '❌ 失败' }}
                </span>
              </div>
              <div v-if="checkResult.syntax.output" class="res-out mono">{{ checkResult.syntax.output }}</div>
              <div class="res-line">
                <span class="res-k">本机同名 conf</span>
                <span v-if="checkResult.localFiles.length" class="res-v">
                  <span v-for="lf in checkResult.localFiles" :key="lf.path" class="mono lf">
                    {{ lf.path }}
                    <b :class="lf.md5Match ? 'ok' : 'warn'">{{ lf.md5Match ? '✓ 与项目一致' : '⚠ 与项目不一致' }}</b>
                  </span>
                </span>
                <span v-else class="res-v dim">本机 include 目录下无此文件</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nginx-panel { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.hint { color: var(--text-dim, #6b6b78); font-size: 12px; text-align: center; padding: 16px 0; }
.ok { color: var(--glow, #22ee66); }
.warn { color: #f2cc60; }
.err { color: #f44747; }
.dim { color: var(--text-dim, #6b6b78); }
.mono { font-family: var(--font, monospace); }
.sub { font-size: 10px; color: var(--text-dim, #6b6b78); font-weight: 400; margin-left: 8px; }

/* 状态卡 */
.stat-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a); border-radius: 10px;
}
.stat-title { font-size: 13px; font-weight: 700; color: var(--text, #c8c8d0); display: flex; align-items: baseline; }
.stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; }
.stat { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.stat.wide { grid-column: 1 / -1; }
.stat .k { flex-shrink: 0; font-size: 11px; color: var(--text-dim, #6b6b78); }
.stat .v { font-size: 12px; color: var(--text, #c8c8d0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warn-line { font-size: 11px; color: #f2cc60; }

/* conf 卡片 */
.conf-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a); border-radius: 10px;
  flex: 1; min-height: 0;
}
.conf-title { font-size: 13px; font-weight: 700; color: var(--text, #c8c8d0); display: flex; align-items: baseline; }
.conf-body { display: flex; gap: 10px; flex: 1; min-height: 240px; }
.conf-list {
  width: 200px; flex-shrink: 0; overflow-y: auto;
  border: 1px solid var(--border, #23232a); border-radius: 8px; padding: 4px;
  display: flex; flex-direction: column; gap: 2px; background: var(--surface, #131316);
}
.conf-item {
  padding: 6px 8px; font-size: 12px; font-family: var(--font, monospace);
  color: var(--text-dim, #6b6b78); border-radius: 5px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.conf-item:hover { background: rgba(34,238,102,0.06); color: var(--text, #c8c8d0); }
.conf-item.on { background: rgba(34,238,102,0.12); color: var(--glow, #22ee66); border: 1px solid var(--glow-dim); }

.conf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.conf-actions { display: flex; align-items: center; gap: 10px; }
.cur-file { font-size: 12px; font-family: var(--font, monospace); color: var(--text, #c8c8d0); }
.chk-btn {
  margin-left: auto; padding: 6px 12px; font-size: 12px; border-radius: 5px;
  background: var(--glow-dim); color: var(--text, #c8c8d0); border: 1px solid var(--glow, #22ee66); cursor: pointer;
}
.chk-btn:hover:not(:disabled) { background: rgba(34,238,102,0.2); }
.chk-btn:disabled { opacity: 0.5; cursor: default; }
.conf-text {
  flex: 1; min-height: 160px; resize: vertical;
  padding: 10px; font-size: 11px; line-height: 1.6;
  background: #0a0a0c; color: #b8c0c8; border: 1px solid var(--border, #23232a);
  border-radius: 8px; outline: none;
}

/* 检测结果 */
.chk-result {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; background: var(--surface, #131316);
  border: 1px solid var(--border, #23232a); border-radius: 8px;
}
.res-line { display: flex; align-items: baseline; gap: 10px; }
.res-k { flex-shrink: 0; font-size: 11px; color: var(--text-dim, #6b6b78); width: 72px; }
.res-v { font-size: 12px; color: var(--text, #c8c8d0); }
.res-out {
  font-size: 10px; color: var(--text-dim, #6b6b78); white-space: pre-wrap; word-break: break-all;
  max-height: 80px; overflow-y: auto; background: #0a0a0c; border-radius: 6px; padding: 6px 8px;
}
.lf { display: block; line-height: 1.7; }
.lf b { margin-left: 6px; }
</style>
