<script setup lang="ts">
// ── 全局配置面板(Tab:项目 / 账号)────────────────────────
//   打开入口:每页左上角 ⚙(Sidebar)。项目切换/添加、账号改密/登出。
//   日志/库/仓库/PRD 等不做手配 UI,统一在项目 .code-panel/*.yaml 维护。

import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/utils/api-fetch'
import { useProjectsStore } from '@/stores/projects'
import { useAuthStore } from '@/stores/auth'
import BackupPanel from '@/components/BackupPanel.vue'
import NginxPanel from '@/components/NginxPanel.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const projects = useProjectsStore()
const auth = useAuthStore()
const router = useRouter()

type TabKey = 'project' | 'backup' | 'files' | 'nginx' | 'account'
const activeTab = ref<TabKey>('project')
const tabs: { key: TabKey; label: string }[] = [
  { key: 'project', label: '项目' },
  { key: 'backup', label: '备份' },
  { key: 'files', label: '文件' },
  { key: 'nginx', label: 'nginx' },
  { key: 'account', label: '账号' },
]

// ── 项目 ────────────────────────────────────────────────
const addName = ref('')
const addRoot = ref('')
const addNote = ref('')
const addErr = ref('')
const adding = ref(false)
const showAdd = ref(false) // 添加表单默认折叠

async function handleAddProject() {
  addErr.value = ''
  if (!addName.value.trim() || !addRoot.value.trim()) { addErr.value = '请填写项目名与项目根目录'; return }
  adding.value = true
  try {
    await projects.addProject({ name: addName.value.trim(), root: addRoot.value.trim(), note: addNote.value.trim() })
    addName.value = ''
    addRoot.value = ''
    addNote.value = ''
    showAdd.value = false
  } catch (e: any) {
    addErr.value = e.message || '添加失败'
  } finally {
    adding.value = false
  }
}

async function handleRemoveProject(id: string) {
  if (!window.confirm(`移除项目 #${id} 的注册?(不会删除其磁盘 .code-panel)继续?`)) return
  try {
    await projects.removeProject(id)
  } catch (e: any) {
    alert(e.message || '移除失败')
  }
}

// ── 编辑项目(名称/备注)──────────────────────────────
const editingId = ref<string | null>(null)
const editName = ref('')
const editNote = ref('')
const editErr = ref('')

function openEdit(p: { id: string; name: string; note?: string }) {
  editingId.value = p.id
  editName.value = p.name
  editNote.value = p.note || ''
  editErr.value = ''
}

async function saveEdit() {
  if (!editingId.value) return
  editErr.value = ''
  if (!editName.value.trim()) { editErr.value = '项目名必填'; return }
  try {
    await projects.updateProject(editingId.value, {
      name: editName.value.trim(),
      note: editNote.value.trim(),
    })
    editingId.value = null
  } catch (e: any) {
    editErr.value = e.message || '保存失败'
  }
}

// ── 账号 ────────────────────────────────────────────────
const oldPwd = ref('')
const newPwd = ref('')
const pwdMsg = ref('')
const pwdErr = ref('')
const pwdBusy = ref(false)
const pwdOpen = ref(false) // 改密表单默认折叠,点卡片展开

function resetPwd() {
  oldPwd.value = ''
  newPwd.value = ''
  pwdMsg.value = ''
  pwdErr.value = ''
}

async function changePassword() {
  pwdMsg.value = ''
  pwdErr.value = ''
  if (!oldPwd.value || !newPwd.value) { pwdErr.value = '请填写旧密码与新密码'; return }
  if (newPwd.value.length < 4) { pwdErr.value = '新密码至少 4 位'; return }
  pwdBusy.value = true
  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd.value, newPassword: newPwd.value }),
    })
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '修改失败')
    pwdMsg.value = '✓ 密码已修改'
    pwdOpen.value = false
    resetPwd()
  } catch (e: any) {
    pwdErr.value = e.message || '修改失败'
  } finally {
    pwdBusy.value = false
  }
}

async function logout() {
  await auth.logout()
  emit('close')
  router.push('/login')
}

// ── 文件(当前项目云上传/下载目录)──────────────────────
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
  } catch (e: any) {
    fileErr.value = e.message || '读取失败'
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
  } catch (e: any) {
    fileErr.value = e.message || '保存失败'
  } finally {
    fileBusy.value = false
  }
}

function resetFilesCfg() {
  upDir.value = ''
  downDir.value = ''
  saveFilesCfg()
}

watch(activeTab, (t) => { if (t === 'files') loadFilesCfg() })
watch(() => projects.currentId, () => { if (activeTab.value === 'files') loadFilesCfg() })
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal">
        <div class="modal-header">
          <span>⚙ 配置</span>
          <button class="close" title="关闭" @click="emit('close')">✕</button>
        </div>

        <div class="tabs">
          <button
            v-for="t in tabs" :key="t.key"
            class="tab" :class="{ on: activeTab === t.key }"
            @click="activeTab = t.key"
          >{{ t.label }}</button>
        </div>

        <div class="modal-body">
          <!-- ── 项目 ── -->
          <div v-if="activeTab === 'project'" class="tab-pane">
            <div v-if="!projects.projects.length" class="hint">还没有项目,在下面添加一个。</div>
            <div v-else class="proj-grid">
              <div
                v-for="p in projects.projects" :key="p.id"
                class="proj-card" :class="{ cur: p.id === projects.currentId }"
              >
                <div class="card-head">
                  <span class="proj-name" :title="p.name">{{ p.name }}</span>
                  <span class="proj-id">#{{ p.id }}</span>
                </div>
                <div class="proj-root" :title="p.root">{{ p.root }}</div>
                <div v-if="p.note" class="proj-note">📝 {{ p.note }}</div>

                <!-- 编辑(改名称/备注) -->
                <div v-if="editingId === p.id" class="edit-card">
                  <input v-model="editName" class="f-input" placeholder="项目名(文件夹名)" />
                  <input v-model="editNote" class="f-input mono" placeholder="中文备注(可选,便于团队识别)" @keyup.enter="saveEdit" />
                  <div v-if="editErr" class="err">{{ editErr }}</div>
                  <div class="edit-btns">
                    <button class="mini" @click="editingId = null">取消</button>
                    <button class="mini save" @click="saveEdit">保存</button>
                  </div>
                </div>

                <div class="card-foot">
                  <span class="foot-left">
                    <button class="mini" title="编辑名称/备注" @click="openEdit(p)">编辑</button>
                    <button class="mini danger" title="移除注册" @click="handleRemoveProject(p.id)">移除</button>
                  </span>
                  <button class="use-btn" :disabled="p.id === projects.currentId" @click="projects.setProject(p.id)">
                    {{ p.id === projects.currentId ? '✓ 使用中' : '使用' }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 添加项目:放在最下面靠左,默认折叠 -->
            <div v-if="showAdd" class="add-card">
              <div class="add-title">+ 添加项目</div>
              <div class="add-fields">
                <input v-model="addName" class="f-input" placeholder="项目名(如 demo)" />
                <input v-model="addNote" class="f-input" placeholder="中文备注(可选)" />
                <input v-model="addRoot" class="f-input mono grow" placeholder="项目根目录绝对路径" />
              </div>
              <div class="add-err-line">
                <span v-if="addErr" class="err">{{ addErr }}</span>
                <span class="spacer" />
                <button class="ghost" :disabled="adding" @click="showAdd = false">取消</button>
                <button class="primary" :disabled="adding" @click="handleAddProject">
                  {{ adding ? '添加中…' : '添加并切换' }}
                </button>
              </div>
            </div>
            <div v-else class="add-zone">
              <button class="ghost add-left" @click="showAdd = true">＋ 添加项目</button>
            </div>
          </div>

          <!-- ── 备份 ── -->
          <div v-else-if="activeTab === 'backup'" class="tab-pane">
            <BackupPanel />
          </div>

          <!-- ── 文件(当前项目的云上传/下载目录)── -->
          <div v-else-if="activeTab === 'files'" class="tab-pane">
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
          </div>

          <!-- ── nginx(检测当前项目 .code-panel/nginx conf 是否被本机加载)── -->
          <div v-else-if="activeTab === 'nginx'" class="tab-pane">
            <NginxPanel />
          </div>

          <!-- ── 账号 ── -->
          <div v-else class="tab-pane">
            <div class="acct-line">当前账号:<b>{{ auth.username }}</b></div>

            <!-- 修改密码:卡片式,点击展开 -->
            <div class="acct-card" @click="!pwdOpen && (pwdOpen = true)">
              <div class="acct-card-head">
                <span class="acct-card-title">修改密码</span>
                <span v-if="!pwdOpen" class="chev">▸</span>
                <span v-else class="chev on">▾</span>
              </div>

              <div v-if="pwdOpen" class="pwd-form">
                <div class="acct-grid">
                  <input v-model="oldPwd" class="f-input" type="password" placeholder="旧密码" @click.stop />
                  <input v-model="newPwd" class="f-input" type="password" placeholder="新密码(≥4 位)" @click.stop />
                </div>
                <div v-if="pwdMsg" class="ok">{{ pwdMsg }}</div>
                <div v-if="pwdErr" class="err">{{ pwdErr }}</div>
                <div class="pwd-btns">
                  <button class="ghost" @click.stop="pwdOpen = false">取消</button>
                  <button class="primary" :disabled="pwdBusy" @click.stop="changePassword">{{ pwdBusy ? '提交中…' : '确认修改' }}</button>
                </div>
              </div>
            </div>

            <div class="divider" />

            <!-- 退出登录 -->
            <button class="danger-btn" @click="logout">退出登录</button>
          </div>
        </div>

        <div class="modal-footer">
          <span class="foot">当前项目:#{{ projects.currentProject?.id || '—' }} {{ projects.currentProject?.name || '' }}</span>
          <button class="ghost" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  width: 960px; max-width: 96vw; height: 88vh; max-height: 88vh;
  display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--text);
}
.modal-header .close { background: transparent; border: none; color: var(--text-dim); font-size: 16px; cursor: pointer; }
.modal-header .close:hover { color: #f44747; }

.tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--border); }
.tab {
  padding: 7px 16px; font-size: 12px; color: var(--text-dim);
  background: transparent; border: 1px solid transparent; border-bottom: none;
  border-radius: 6px 6px 0 0; cursor: pointer;
}
.tab.on { color: var(--glow); background: var(--bg); border-color: var(--border); }

.modal-body { flex: 1; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; }
.tab-pane { display: flex; flex-direction: column; gap: 8px; }
.hint { font-size: 12px; color: var(--text-dim); text-align: center; padding: 16px 0; }
.err { font-size: 11px; color: #f44747; }
.ok { font-size: 11px; color: var(--glow); }
.divider { border-top: 1px solid var(--border); margin: 10px 0; }

.proj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.proj-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px; background: var(--bg);
  border: 1px solid var(--border); border-radius: 10px;
  transition: border-color .15s, box-shadow .15s;
}
.proj-card:hover { border-color: var(--text-dim); }
.proj-card.cur { border-color: var(--glow-dim); box-shadow: 0 0 0 1px var(--glow-dim) inset; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.proj-name { font-size: 15px; color: var(--text); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj-id { flex-shrink: 0; font-size: 11px; color: var(--text-dim); font-family: var(--font); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1px 8px; }
.proj-root { font-size: 11px; line-height: 1.5; color: var(--text-dim); font-family: var(--font); word-break: break-all; }
.proj-note { font-size: 12px; color: var(--text); background: rgba(68,153,238,0.08); border: 1px solid rgba(68,153,238,0.2); border-radius: 6px; padding: 3px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; }
.foot-left { display: flex; align-items: center; gap: 6px; }
.edit-card { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--surface); border: 1px dashed var(--border); border-radius: 8px; }
.edit-btns { display: flex; justify-content: flex-end; gap: 6px; }
button.mini.save { color: var(--glow); border-color: var(--glow-dim); }
button.mini.save:hover { background: rgba(34,238,102,0.1); color: var(--glow); }
/* 次操作「移除」在左(默认透明),主操作「使用」在右(高亮) */
.card-foot .mini.danger { padding: 6px 12px; border-radius: 6px; }
.use-btn { padding: 6px 16px; font-size: 12px; border-radius: 6px; cursor: pointer; }
.use-btn:not(:disabled) { background: rgba(34,238,102,0.12); color: var(--glow); border: 1px solid var(--glow-dim); }
.use-btn:not(:disabled):hover { background: rgba(34,238,102,0.2); }
.use-btn:disabled { background: var(--glow-dim); color: #09090b; border: 1px solid var(--glow); opacity: .85; cursor: default; }

/* 添加项目:放最下面靠左,默认折叠 */
.add-zone { margin-top: 14px; display: flex; }
.add-left { border-style: dashed; padding: 8px 18px; }
.add-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; margin-top: 14px; background: var(--bg); border: 1px dashed var(--glow-dim); border-radius: 10px; }
.add-title { font-size: 13px; color: var(--text); font-weight: 600; }
.add-fields { display: flex; gap: 8px; align-items: center; }
.add-fields .f-input { flex: 0 0 30%; }
.add-fields .f-input.grow { flex: 1 1 auto; }
.add-err-line { display: flex; align-items: center; gap: 8px; }
.add-err-line .spacer { flex: 1; }
.add-err-line button { margin-left: 4px; }

.f-input { padding: 7px 10px; font-size: 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 4px; outline: none; }
.f-input:focus { border-color: var(--glow-dim); }
.f-input.mono { font-family: var(--font); }
button.primary { padding: 7px 16px; font-size: 12px; border-radius: 4px; cursor: pointer; background: var(--glow-dim); color: var(--text); border: 1px solid var(--glow); }
button.primary:disabled { opacity: .5; cursor: default; }
button.ghost { padding: 7px 16px; font-size: 12px; border-radius: 4px; cursor: pointer; background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
button.mini { background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 4px; font-size: 11px; padding: 2px 6px; cursor: pointer; }
button.mini.danger:hover { color: #f44747; border-color: #f44747; }

.acct-line { font-size: 12px; color: var(--text-dim); }
.acct-card { border: 1px solid var(--border); background: var(--bg); border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: border-color .15s; }
.acct-card:hover { border-color: var(--text-dim); }
.acct-card-head { display: flex; align-items: center; justify-content: space-between; }
.acct-card-title { font-size: 13px; font-weight: 600; color: var(--text); }
.chev { color: var(--text-dim); font-size: 12px; }
.pwd-form { margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.pwd-btns { display: flex; justify-content: flex-end; gap: 8px; }
.acct-grid { display: flex; gap: 8px; }
.acct-grid .f-input { flex: 1; }

/* ── 文件 Tab ── */
.files-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; }
.files-title { font-size: 13px; font-weight: 700; color: var(--text); }
.files-sub { font-size: 11px; color: var(--text-dim); line-height: 1.6; }
.acct-grid.col { flex-direction: column; align-items: stretch; gap: 4px; }
.f-label { font-size: 11px; color: var(--text-dim); }
.files-btns { display: flex; align-items: center; gap: 8px; }
.files-btns .spacer { flex: 1; }
.danger-btn { align-self: flex-start; padding: 8px 20px; font-size: 12px; border-radius: 4px; cursor: pointer; background: transparent; color: #f44747; border: 1px solid #f44747; }
.danger-btn:hover { background: rgba(244,71,71,0.1); }

.modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 10px 16px; border-top: 1px solid var(--border);
}
.modal-footer .foot { margin-right: auto; font-size: 11px; color: var(--text-dim); }
</style>
