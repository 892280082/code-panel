<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { ref, watch } from 'vue'

const open = ref(false)
const pathInput = ref('')
const pathError = ref('')
const saving = ref(false)
const backups = ref<any[]>([])
const maxKeep = ref(20)
const running = ref(false)
const runMsg = ref('')

async function loadConfig() {
  try {
    const res = await apiFetch('/api/backup/config')
    const data = await res.json()
    if (data.ok) {
      pathInput.value = data.data.path
      maxKeep.value = data.data.maxKeep
    }
  } catch { /* ignore */ }
}

async function loadList() {
  try {
    const res = await apiFetch('/api/backup/list')
    const data = await res.json()
    if (data.ok) backups.value = data.data
  } catch { /* ignore */ }
}

function toggle() {
  open.value = !open.value
  if (open.value) { loadConfig(); loadList() }
}

async function handleSavePath() {
  pathError.value = ''
  if (!pathInput.value.trim()) { pathError.value = '请输入备份路径'; return }
  saving.value = true
  try {
    const res = await apiFetch('/api/backup/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathInput.value.trim() })
    })
    const data = await res.json()
    if (!data.ok) { pathError.value = data.error || '保存失败' }
    else loadList()
  } catch {
    pathError.value = '网络错误'
  } finally {
    saving.value = false
  }
}

async function handleRun() {
  if (running.value) return
  running.value = true
  runMsg.value = ''
  try {
    const res = await apiFetch('/api/backup/run', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      runMsg.value = '✓ 备份完成:' + (data.data.file || '').split('/').pop()
      loadList()
    } else {
      runMsg.value = '✗ ' + (data.error || '备份失败')
    }
  } catch {
    runMsg.value = '✗ 网络错误'
  } finally {
    running.value = false
  }
}

/** 文件大小人性化显示 */
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

watch(open, (o) => { if (!o) runMsg.value = '' })
</script>

<template>
  <div class="backup-root">
    <button
      class="backup-trigger"
      :class="{ on: open }"
      :title="open ? '关闭定期备份' : '定期备份'"
      @click="toggle"
    >
      🛡 备份
    </button>

    <Teleport to="body">
      <div v-if="open" class="drawer-backdrop" @click="open = false" />
      <div v-if="open" class="drawer-panel" @click.stop>
        <!-- 固定头部 -->
        <div class="drawer-header">
          <span class="drawer-title">定期备份</span>
          <button class="drawer-close" @click="open = false">✕</button>
        </div>

        <!-- 滚动内容区 -->
        <div class="drawer-scroll">
          <!-- 备份路径配置 -->
          <div class="cfg-card">
            <div class="cfg-label">备份路径</div>
            <div class="cfg-row">
              <input v-model="pathInput" class="form-input mono" placeholder="/path/to/backup" @keyup.enter="handleSavePath" />
              <button class="save-btn" :disabled="saving" @click="handleSavePath">保存</button>
            </div>
            <div v-if="pathError" class="form-error">{{ pathError }}</div>
            <div class="cfg-hint">数据文件打包为 backup-日期.tar.gz,存入该目录</div>
          </div>

          <!-- 立即备份 -->
          <button class="run-btn" :disabled="running" @click="handleRun">
            <span v-if="running">⏳ 备份中…</span>
            <span v-else>⟳ 立即备份</span>
          </button>
          <div v-if="runMsg" class="run-msg" :class="{ ok: runMsg.startsWith('✓') }">{{ runMsg }}</div>

          <!-- 备份列表 -->
          <div class="list-title">
            <span>备份文件({{ backups.length }})</span>
            <span class="list-hint">最多保留 {{ maxKeep }} 个</span>
          </div>

          <div v-if="backups.length === 0" class="section-hint">
            暂无备份,点击「立即备份」或等待下次程序启动
          </div>

          <div v-for="bk in backups" :key="bk.name" class="backup-card">
            <div class="backup-info">
              <span class="backup-name">{{ bk.name }}</span>
              <span class="backup-date">{{ bk.date }}</span>
            </div>
            <span class="backup-size">{{ fmtSize(bk.size) }}</span>
            <a
              class="dl-btn"
              :href="`/api/backup/download/${bk.name}`"
              :title="`下载 ${bk.name}`"
              download
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
          </div>

          <div class="footer-hint">
            每天自动备份一次:程序每次启动时执行,当天的备份会覆盖替换;仅保留最近 {{ maxKeep }} 个。
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Toolbar 触发按钮 ────────────────────────────────── */
.backup-trigger {
  font-family: var(--font); font-size: 10px;
  padding: 5px 12px;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; letter-spacing: 0.04em;
  transition: all 0.15s;
  white-space: nowrap;
}
.backup-trigger:hover { color: var(--text); border-color: var(--glow-dim); background: rgba(34,238,102,0.04); }
.backup-trigger.on { color: var(--glow); border-color: var(--glow-dim); background: rgba(34,238,102,0.06); }

/* ── 抽屉 ─────────────────────────────────────────────── */
.drawer-backdrop {
  position: fixed; inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.3);
}
.drawer-panel {
  position: fixed;
  top: 0; right: 0;
  width: 340px; height: 100vh;
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

/* ── 路径配置 ─────────────────────────────────────────── */
.cfg-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
}
.cfg-label { font-size: 12px; color: var(--text, #c8c8d0); font-weight: 500; }
.cfg-row { display: flex; gap: 6px; }
.cfg-row .form-input { flex: 1; min-width: 0; }
.cfg-hint { font-size: 10px; color: var(--text-dim, #6b6b78); }
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
.save-btn {
  padding: 8px 14px;
  border: 1px solid var(--glow-dim, rgba(34,238,102,0.3));
  border-radius: 4px;
  background: transparent;
  color: var(--glow, #22ee66);
  font-size: 12px; cursor: pointer;
  white-space: nowrap;
}
.save-btn:hover:not(:disabled) { background: rgba(34,238,102,0.08); }
.save-btn:disabled { opacity: 0.5; cursor: default; }
.form-error { color: #f44747; font-size: 11px; }

/* ── 立即备份 ─────────────────────────────────────────── */
.run-btn {
  width: 100%; padding: 10px;
  background: var(--glow, #22ee66);
  border: none; border-radius: 6px;
  color: #09090b; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity 0.2s;
}
.run-btn:hover:not(:disabled) { opacity: 0.85; }
.run-btn:disabled { opacity: 0.5; cursor: default; }
.run-msg { font-size: 11px; color: #f44747; padding: 0 2px; }
.run-msg.ok { color: var(--glow, #22ee66); }

/* ── 列表 ─────────────────────────────────────────────── */
.list-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--text, #c8c8d0); font-weight: 500;
  margin-top: 6px;
}
.list-hint { font-size: 10px; color: var(--text-dim, #6b6b78); font-weight: 400; }
.section-hint {
  color: var(--text-dim, #6b6b78);
  font-size: 12px; text-align: center; padding: 16px 0;
}
.backup-card {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a);
  border-radius: 6px;
}
.backup-card:hover { border-color: rgba(34,238,102,0.3); }
.backup-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 3px;
}
.backup-name {
  font-size: 12px; color: var(--text, #c8c8d0);
  font-family: var(--font, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.backup-date { font-size: 10px; color: var(--text-dim, #6b6b78); }
.backup-size {
  font-size: 11px; color: var(--text-dim, #6b6b78);
  font-variant-numeric: tabular-nums; flex-shrink: 0;
}
.dl-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border-radius: 4px;
  color: var(--text-dim, #6b6b78);
  text-decoration: none;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}
.dl-btn:hover { color: var(--glow, #22ee66); background: rgba(34,238,102,0.08); }

/* ── 底部提示 ─────────────────────────────────────────── */
.footer-hint {
  font-size: 10px; color: var(--text-dim, #6b6b78);
  line-height: 1.6; text-align: center;
  border-top: 1px solid var(--border, #23232a);
  padding-top: 10px; margin-top: 4px;
}
</style>
