<script setup lang="ts">
// ── 备份面板(内容区;嵌入 ⚙ 配置「备份」Tab)────────────────
//   从原 BackupDrawer 抽出:配置路径 / 立即备份 / 列表下载,去掉浮层按钮。

import { apiFetch } from '@/utils/api-fetch'
import { ref, onMounted } from 'vue'
import { fmtSize } from '@/utils/format'

const pathInput = ref('')
const pathError = ref('')
const saving = ref(false)
/** 备份条目(镜像 src/backup/backup-manager.ts listBackups) */
interface BackupEntry { name: string; size: number; date: string }
const backups = ref<BackupEntry[]>([])
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

async function handleSavePath() {
  pathError.value = ''
  if (!pathInput.value.trim()) { pathError.value = '请输入备份路径'; return }
  saving.value = true
  try {
    const res = await apiFetch('/api/backup/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathInput.value.trim() }),
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


onMounted(() => {
  loadConfig()
  loadList()
})
</script>

<template>
  <div class="backup-panel">
    <!-- 备份路径配置 -->
    <div class="cfg-card">
      <div class="cfg-label">备份路径</div>
      <div class="cfg-row">
        <input v-model="pathInput" class="form-input mono" placeholder="/path/to/backup" @keyup.enter="handleSavePath" />
        <button class="save-btn" :disabled="saving" @click="handleSavePath">保存</button>
      </div>
      <div v-if="pathError" class="form-error">{{ pathError }}</div>
      <div class="cfg-hint">打包 global.code-panel + 各项目 .code-panel 为 backup-日期.tar.gz</div>
    </div>

    <!-- 立即备份 -->
    <div class="run-row">
      <button class="run-btn" :disabled="running" @click="handleRun">
        <span v-if="running">⏳ 备份中…</span>
        <span v-else>⟳ 立即备份</span>
      </button>
      <div v-if="runMsg" class="run-msg" :class="{ ok: runMsg.startsWith('✓') }">{{ runMsg }}</div>
    </div>

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
      >⤓</a>
    </div>
  </div>
</template>

<style scoped>
.backup-panel { display: flex; flex-direction: column; gap: 10px; }
.cfg-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a); border-radius: 8px;
}
.cfg-label { font-size: 12px; color: var(--text, #c8c8d0); font-weight: 500; }
.cfg-row { display: flex; gap: 6px; }
.cfg-row .form-input { flex: 1; min-width: 0; }
.cfg-hint { font-size: 10px; color: var(--text-dim, #6b6b78); }
.form-input {
  padding: 8px 10px; border: 1px solid var(--border, #23232a); border-radius: 4px;
  background: var(--surface, #131316); color: var(--text, #c8c8d0); font-size: 12px; outline: none;
}
.form-input:focus { border-color: var(--glow, #22ee66); }
.form-input.mono { font-family: var(--font, monospace); }
.form-error { color: #f44747; font-size: 11px; }
.save-btn {
  padding: 8px 14px; border: 1px solid var(--glow-dim, rgba(34,238,102,0.3));
  border-radius: 4px; background: transparent; color: var(--glow, #22ee66);
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.save-btn:hover:not(:disabled) { background: rgba(34,238,102,0.08); }
.save-btn:disabled { opacity: 0.5; cursor: default; }

.run-row { display: flex; align-items: center; gap: 10px; }
.run-btn {
  padding: 10px 18px; background: var(--glow, #22ee66); border: none; border-radius: 6px;
  color: #09090b; font-size: 13px; font-weight: 600; cursor: pointer;
}
.run-btn:hover:not(:disabled) { opacity: 0.85; }
.run-btn:disabled { opacity: 0.5; cursor: default; }
.run-msg { font-size: 11px; color: #f44747; }
.run-msg.ok { color: var(--glow, #22ee66); }

.list-title { display: flex; justify-content: space-between; font-size: 12px; color: var(--text, #c8c8d0); font-weight: 500; }
.list-hint { font-size: 10px; color: var(--text-dim, #6b6b78); font-weight: 400; }
.section-hint { color: var(--text-dim, #6b6b78); font-size: 12px; text-align: center; padding: 14px 0; }
.backup-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--bg, #09090b);
  border: 1px solid var(--border, #23232a); border-radius: 8px;
}
.backup-card:hover { border-color: rgba(34,238,102,0.3); }
.backup-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.backup-name { font-size: 12px; color: var(--text, #c8c8d0); font-family: var(--font, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.backup-date { font-size: 10px; color: var(--text-dim, #6b6b78); }
.backup-size { font-size: 11px; color: var(--text-dim, #6b6b78); flex-shrink: 0; }
.dl-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px;
  color: var(--text-dim, #6b6b78); text-decoration: none; flex-shrink: 0;
  border: 1px solid var(--border, #23232a);
}
.dl-btn:hover { color: var(--glow, #22ee66); border-color: var(--glow-dim); }
</style>
