<script setup lang="ts">
// ── 项目面板(内容区;嵌入 ⚙ 配置「项目」Tab)────────────────
//   从 GlobalConfigModal 内联 Tab 抽出(形态对齐 UsersPanel 等面板):
//   项目卡片网格(使用/编辑/移除)+ 底部添加表单(默认折叠,仅超管)。

import { ref } from 'vue'
import { errText } from '@/utils/api-fetch'
import { useProjectsStore } from '@/stores/projects'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{ (e: 'used'): void }>()

const projects = useProjectsStore()
const auth = useAuthStore()

// ── 添加项目 ────────────────────────────────────────────
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
  } catch (e) {
    addErr.value = errText(e, '添加失败')
  } finally {
    adding.value = false
  }
}

const removeErr = ref('')   // 移除失败的内联错误(替代 alert)

async function handleRemoveProject(id: string) {
  if (!window.confirm(`移除项目 #${id} 的注册?(不会删除其磁盘 .code-panel)继续?`)) return
  removeErr.value = ''
  try {
    await projects.removeProject(id)
  } catch (e) {
    removeErr.value = errText(e, '移除失败')
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
  } catch (e) {
    editErr.value = errText(e, '保存失败')
  }
}
</script>

<template>
  <div v-if="removeErr" class="err">{{ removeErr }}</div>
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

      <!-- 编辑(改名称/备注;仅超管) -->
      <div v-if="editingId === p.id && auth.isSuper" class="edit-card">
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
          <template v-if="auth.isSuper">
            <button class="mini" title="编辑名称/备注" @click="openEdit(p)">编辑</button>
            <button class="mini danger" title="移除注册" @click="handleRemoveProject(p.id)">移除</button>
          </template>
        </span>
        <button class="use-btn" :disabled="p.id === projects.currentId" @click="projects.setProject(p.id); emit('used')">
          {{ p.id === projects.currentId ? '✓ 使用中' : '使用' }}
        </button>
      </div>
    </div>
  </div>

  <!-- 添加项目:放在最下面靠左,默认折叠(仅超管) -->
  <div v-if="showAdd && auth.isSuper" class="add-card">
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
  <div v-else-if="auth.isSuper" class="add-zone">
    <button class="ghost add-left" @click="showAdd = true">＋ 添加项目</button>
  </div>
</template>

<style scoped>
.hint { font-size: 12px; color: var(--text-dim); text-align: center; padding: 16px 0; }
.err { font-size: 11px; color: #f44747; }

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

button.mini { background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 4px; font-size: 11px; padding: 2px 6px; cursor: pointer; }
button.mini.danger:hover { color: #f44747; border-color: #f44747; }
</style>
