<script setup lang="ts">
// ── 文件交换面板(内容区;嵌入 ⚙ 配置「文件」Tab)────────────
//   从 GlobalConfigModal 内联 Tab 抽出:当前项目的云上传/下载目录配置。
//   时序说明:原为「切到本 Tab 时读取」,本面板仅在 Tab 激活时挂载(v-else-if),
//   故挂载即读取等价;切项目重读同样等价(面板未挂载时不触发)。

import { ref, watch, onMounted } from 'vue'
import { apiFetch, errText } from '@/utils/api-fetch'
import { useProjectsStore } from '@/stores/projects'

const projects = useProjectsStore()

const upDir = ref('')
const downDir = ref('')
const fileMsg = ref('')
const fileErr = ref('')
const fileBusy = ref(false)

async function loadFilesCfg() {
  fileMsg.value = ''; fileErr.value = ''
  if (!projects.currentId) { upDir.value = ''; downDir.value = ''; return }
  try {
    const res = await apiFetch(`/api/files/config?project=${encodeURIComponent(projects.currentId)}`)
    const data = await res.json()
    if (data?.ok) {
      upDir.value = data.data.upload
      downDir.value = data.data.download
    } else throw new Error(data?.error || '读取失败')
  } catch (e) {
    fileErr.value = errText(e, '读取失败')
  }
}

async function saveFilesCfg() {
  if (!projects.currentId) return
  fileMsg.value = ''; fileErr.value = ''
  fileBusy.value = true
  try {
    const res = await apiFetch(`/api/files/config?project=${encodeURIComponent(projects.currentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload: upDir.value, download: downDir.value }),
    })
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '保存失败')
    fileMsg.value = '✓ 已保存'
    loadFilesCfg()
  } catch (e) {
    fileErr.value = errText(e, '保存失败')
  } finally {
    fileBusy.value = false
  }
}

function resetFilesCfg() {
  upDir.value = ''
  downDir.value = ''
  saveFilesCfg()
}

onMounted(loadFilesCfg)
watch(() => projects.currentId, loadFilesCfg)
</script>

<template>
  <div v-if="!projects.currentProject" class="hint">先选一个项目,再配置它的上传 / 下载目录。</div>
  <div v-else class="files-card">
    <div class="files-title">
      ☁ 文件交换目录(项目「{{ projects.currentProject.name }}」)
    </div>
    <div class="files-sub">上传 = 浏览器传到服务器,复制绝对路径给终端/AI;下载 = AI 写文件进来,你取回。</div>

    <div class="acct-grid col">
      <label class="f-label">上传目录</label>
      <input v-model="upDir" class="f-input mono" placeholder="默认:&lt;项目根&gt;/.code-panel/uploads" @keyup.enter="saveFilesCfg" />
    </div>
    <div class="acct-grid col">
      <label class="f-label">下载目录</label>
      <input v-model="downDir" class="f-input mono" placeholder="默认:&lt;项目根&gt;/.code-panel/downloads" @keyup.enter="saveFilesCfg" />
    </div>

    <div v-if="fileMsg" class="ok">{{ fileMsg }}</div>
    <div v-if="fileErr" class="err">{{ fileErr }}</div>

    <div class="files-btns">
      <button class="ghost" title="恢复为默认的项目 .code-panel/files 目录" @click="resetFilesCfg">恢复默认</button>
      <span class="spacer" />
      <button class="primary" :disabled="fileBusy" @click="saveFilesCfg">{{ fileBusy ? '保存中…' : '保存' }}</button>
    </div>
  </div>
</template>

<style scoped>
.hint { font-size: 12px; color: var(--text-dim); text-align: center; padding: 16px 0; }
.err { font-size: 11px; color: #f44747; }
.ok { font-size: 11px; color: var(--glow); }

/* ── 文件 Tab ── */
.files-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; }
.files-title { font-size: 13px; font-weight: 700; color: var(--text); }
.files-sub { font-size: 11px; color: var(--text-dim); line-height: 1.6; }
.acct-grid { display: flex; gap: 8px; }
.acct-grid.col { flex-direction: column; align-items: stretch; gap: 4px; }
.f-label { font-size: 11px; color: var(--text-dim); }
.f-input { padding: 7px 10px; font-size: 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 4px; outline: none; }
.f-input:focus { border-color: var(--glow-dim); }
.f-input.mono { font-family: var(--font); }
.files-btns { display: flex; align-items: center; gap: 8px; }
.files-btns .spacer { flex: 1; }
button.primary { padding: 7px 16px; font-size: 12px; border-radius: 4px; cursor: pointer; background: var(--glow-dim); color: var(--text); border: 1px solid var(--glow); }
button.primary:disabled { opacity: .5; cursor: default; }
button.ghost { padding: 7px 16px; font-size: 12px; border-radius: 4px; cursor: pointer; background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
</style>
