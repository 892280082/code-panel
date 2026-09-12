<script setup lang="ts">
// ── 用户管理面板(仅超管;嵌入 ⚙ 配置「账号」Tab)────────────
//   布局:左 = 用户列表;右 = 选中用户详情(项目分配/重置密码/删除)。
//   信任模型:只隔离项目可见性 —— 普通用户仅看到被分配的项目,其余功能照常。

import { ref, computed, onMounted } from 'vue'
import { apiFetch, errText } from '@/utils/api-fetch'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'

interface UserView {
  username: string
  role: string
  createdAt: number
  projectIds: string[]
}

const auth = useAuthStore()
const projects = useProjectsStore()

const users = ref<UserView[]>([])
const selected = ref<string | null>(null)   // 选中的用户名;null = 新建表单
const loading = ref(true)
const errMsg = ref('')
const msg = ref('')
const busy = ref(false)

// 新建表单
const newName = ref('')
const newPwd = ref('')
const newProjectIds = ref<string[]>([])

// 重置密码
const resetPwd = ref('')

const selectedUser = computed(() => users.value.find(u => u.username === selected.value) || null)
const showCreate = computed(() => selected.value === null)

async function loadUsers() {
  loading.value = true
  try {
    const res = await apiFetch('/api/users')
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '读取失败')
    users.value = data.data.users
    // 选中者被删/首次进入 → 默认选中当前登录用户
    if (!users.value.some(u => u.username === selected.value)) {
      selected.value = users.value.some(u => u.username === auth.username)
        ? auth.username
        : (users.value[0]?.username ?? null)
    }
  } catch (e) {
    errMsg.value = errText(e, '读取失败')
  } finally {
    loading.value = false
  }
}

function select(username: string) {
  selected.value = username
  errMsg.value = ''
  msg.value = ''
  resetPwd.value = ''
}

function openCreate() {
  selected.value = null
  newName.value = ''
  newPwd.value = ''
  newProjectIds.value = []
  errMsg.value = ''
  msg.value = ''
}

async function submit(payload: Record<string, unknown>, method: 'POST' | 'PUT' | 'DELETE', path: string, okMsg: string, keepSelect?: string): Promise<boolean> {
  busy.value = true
  errMsg.value = ''
  msg.value = ''
  try {
    const res = await apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(payload),
    })
    const data = await res.json()
    if (!data?.ok) throw new Error(data?.error || '操作失败')
    users.value = data.data.users
    if (keepSelect) selected.value = keepSelect
    msg.value = okMsg
    return true
  } catch (e) {
    errMsg.value = errText(e, '操作失败')
    // 目标用户已不存在(列表过期,如他处被删)→ 自动刷新列表,清掉幽灵条目
    if ((errMsg.value || '').includes('不存在')) await loadUsers()
    return false
  } finally {
    busy.value = false
  }
}

function createUser() {
  const name = newName.value.trim()
  if (!name) { errMsg.value = '请输入用户名'; return }
  if (newPwd.value.length < 4) { errMsg.value = '初始密码至少 4 位'; return }
  submit({ username: name, password: newPwd.value, projectIds: newProjectIds.value }, 'POST', '/api/users', `✓ 已创建用户 ${name}`, name)
}

/** 勾选/取消项目分配(实时保存;失败回滚勾选态) */
async function toggleProject(user: UserView, pid: string) {
  const prev = user.projectIds
  const ids = prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]
  user.projectIds = ids // 乐观更新
  const ok = await submit({ projectIds: ids }, 'PUT', `/api/users/${encodeURIComponent(user.username)}`, '✓ 项目分配已保存')
  if (!ok && users.value.some(u => u.username === user.username)) user.projectIds = prev // 用户还在但保存失败 → 回滚
}

function doResetPwd() {
  const u = selectedUser.value
  if (!u) return
  if (resetPwd.value.length < 4) { errMsg.value = '新密码至少 4 位'; return }
  if (!window.confirm(`重置用户 ${u.username} 的密码?`)) return
  const pwd = resetPwd.value
  resetPwd.value = ''
  submit({ password: pwd }, 'PUT', `/api/users/${encodeURIComponent(u.username)}`, '✓ 密码已重置')
}

function removeUser(u: UserView) {
  if (u.username === auth.username) { errMsg.value = '不能删除当前登录的账号'; return }
  if (!window.confirm(`删除用户 ${u.username}?\n其项目分配一并清除,不可恢复。`)) return
  submit({}, 'DELETE', `/api/users/${encodeURIComponent(u.username)}`, `✓ 已删除 ${u.username}`)
}

function roleLabel(r: string) { return r === 'superadmin' ? '超管' : '成员' }
function projectName(pid: string) { return projects.projects.find(p => p.id === pid) }

onMounted(() => {
  loadUsers()
  if (!projects.loaded) projects.load()
})
</script>

<template>
  <div class="users-panel">
    <!-- ── 左:用户列表 ── -->
    <div class="left">
      <div class="left-head">用户({{ users.length }})</div>
      <div class="user-list">
        <div
          v-for="u in users" :key="u.username"
          class="user-item" :class="{ on: u.username === selected, me: u.username === auth.username }"
          @click="select(u.username)"
        >
          <span class="avatar" :class="u.role">{{ u.username.slice(0, 1).toUpperCase() }}</span>
          <span class="uname">{{ u.username }}</span>
          <span v-if="u.username === auth.username" class="me-dot" title="当前登录">●</span>
          <span class="rbadge" :class="u.role">{{ roleLabel(u.role) }}</span>
        </div>
        <div v-if="!loading && !users.length" class="empty">暂无用户</div>
      </div>
      <button class="add-user" :class="{ on: showCreate }" @click="openCreate">＋ 添加用户</button>
    </div>

    <!-- ── 右:详情 / 新建 ── -->
    <div class="right">
      <!-- 新建用户 -->
      <div v-if="showCreate" class="detail">
        <div class="detail-title">新建用户 <span class="sub">创建后可在右侧为其分配项目</span></div>
        <div class="form-row">
          <label class="f-label">用户名</label>
          <input v-model="newName" class="f-input mono" placeholder="zhangsan(字母/数字/-/_,2~32 位)" @keyup.enter="createUser" />
        </div>
        <div class="form-row">
          <label class="f-label">初始密码</label>
          <input v-model="newPwd" class="f-input mono" placeholder="至少 4 位(告诉对方,可随时重置)" @keyup.enter="createUser" />
        </div>
        <div class="form-row col">
          <label class="f-label">分配项目(创建后可随时改)</label>
          <div class="proj-checks">
            <label v-for="p in projects.projects" :key="p.id" class="proj-check">
              <input
                type="checkbox"
                :checked="newProjectIds.includes(p.id)"
                @change="newProjectIds.includes(p.id)
                  ? (newProjectIds = newProjectIds.filter(x => x !== p.id))
                  : (newProjectIds = [...newProjectIds, p.id])"
              />
              <span class="p-name">{{ p.name }}</span>
              <span v-if="p.note" class="p-note">{{ p.note }}</span>
            </label>
            <div v-if="!projects.projects.length" class="empty">还没有注册任何项目</div>
          </div>
        </div>
        <div v-if="errMsg" class="err">{{ errMsg }}</div>
        <div v-if="msg" class="ok">{{ msg }}</div>
        <div class="btn-row">
          <button class="primary" :disabled="busy" @click="createUser">{{ busy ? '创建中…' : '创建用户' }}</button>
        </div>
      </div>

      <!-- 选中用户详情 -->
      <div v-else-if="selectedUser" class="detail">
        <div class="detail-title">
          <span class="avatar lg" :class="selectedUser.role">{{ selectedUser.username.slice(0, 1).toUpperCase() }}</span>
          <span class="uname-lg">{{ selectedUser.username }}</span>
          <span class="rbadge" :class="selectedUser.role">{{ roleLabel(selectedUser.role) }}</span>
          <span v-if="selectedUser.username === auth.username" class="me-tag">当前登录</span>
        </div>

        <!-- 项目分配 -->
        <div class="section">
          <div class="section-title">📂 项目分配 <span class="sub">勾选即保存 —— 该用户登录后只能看到勾选的项目</span></div>
          <div v-if="selectedUser.role === 'superadmin'" class="super-hint">
            超级管理员默认可见全部项目,无需分配
          </div>
          <div v-else class="proj-checks">
            <label
              v-for="p in projects.projects" :key="p.id"
              class="proj-check" :class="{ on: selectedUser.projectIds.includes(p.id) }"
            >
              <input
                type="checkbox"
                :disabled="busy"
                :checked="selectedUser.projectIds.includes(p.id)"
                @change="toggleProject(selectedUser, p.id)"
              />
              <span class="p-name">{{ p.name }}</span>
              <span v-if="p.note" class="p-note">{{ p.note }}</span>
              <span class="p-root">{{ p.root }}</span>
            </label>
            <div v-if="!projects.projects.length" class="empty">还没有注册任何项目</div>
          </div>
          <div v-if="selectedUser.role !== 'superadmin' && !selectedUser.projectIds.length" class="warn">
            ⚠ 未分配任何项目 —— 该用户登录后将看不到任何项目
          </div>
        </div>

        <!-- 重置密码 -->
        <div class="section">
          <div class="section-title">🔑 重置密码 <span class="sub">重置后请告知对方使用新密码登录</span></div>
          <div class="form-row">
            <input
              v-model="resetPwd" class="f-input mono" type="text"
              placeholder="新密码(至少 4 位)" @keyup.enter="doResetPwd"
            />
            <button class="ghost" :disabled="busy" @click="doResetPwd">重置</button>
          </div>
        </div>

        <!-- 删除 -->
        <div class="section">
          <div class="section-title danger">🗑 删除账号</div>
          <button
            class="danger-btn" :disabled="busy || selectedUser.username === auth.username"
            :title="selectedUser.username === auth.username ? '不能删除当前登录的账号' : ''"
            @click="removeUser(selectedUser)"
          >删除用户 {{ selectedUser.username }}</button>
        </div>

        <div v-if="errMsg" class="err">{{ errMsg }}</div>
        <div v-if="msg" class="ok">{{ msg }}</div>
      </div>

      <div v-else class="empty big">← 选择一个用户,或点「＋ 添加用户」</div>
    </div>
  </div>
</template>

<style scoped>
.users-panel {
  display: grid; grid-template-columns: 210px 1fr; gap: 12px;
  min-height: 320px;
}

/* ── 左列 ── */
.left { display: flex; flex-direction: column; gap: 8px; }
.left-head { font-size: 11px; color: var(--text-dim); letter-spacing: 0.05em; padding: 0 2px; }
.user-list {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  border: 1px solid var(--border); border-radius: 8px; padding: 6px;
  background: var(--bg); max-height: 340px; overflow-y: auto;
}
.user-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; transition: background .12s, border-color .12s;
}
.user-item:hover { background: var(--surface); }
.user-item.on { background: var(--surface); border-color: var(--glow-dim); }
.uname { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font); }
.me-dot { color: var(--glow); font-size: 8px; }
.avatar {
  width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.avatar.superadmin { background: rgba(34,238,102,0.15); color: var(--glow); border: 1px solid var(--glow-dim); }
.avatar.user { background: rgba(68,153,238,0.15); color: #4a9eee; border: 1px solid rgba(68,153,238,0.3); }
.avatar.lg { width: 30px; height: 30px; font-size: 15px; }
.rbadge {
  flex-shrink: 0; font-size: 10px; padding: 1px 7px; border-radius: 8px;
  border: 1px solid var(--border); color: var(--text-dim);
}
.rbadge.superadmin { color: var(--glow); border-color: var(--glow-dim); }
.rbadge.user { color: #4a9eee; border-color: rgba(68,153,238,0.3); }
.add-user {
  padding: 8px; font-size: 12px; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--text-dim); border: 1px dashed var(--border);
}
.add-user:hover, .add-user.on { color: var(--glow); border-color: var(--glow-dim); }

/* ── 右列 ── */
.right { min-width: 0; }
.detail {
  display: flex; flex-direction: column; gap: 14px;
  border: 1px solid var(--border); border-radius: 10px; padding: 14px;
  background: var(--bg);
}
.detail-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: var(--text); }
.detail-title .sub { font-size: 11px; font-weight: 400; color: var(--text-dim); }
.uname-lg { font-family: var(--font); }
.me-tag {
  font-size: 10px; color: var(--glow); border: 1px solid var(--glow-dim);
  border-radius: 8px; padding: 1px 8px;
}
.section { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px dashed var(--border); }
.section-title { font-size: 12.5px; font-weight: 600; color: var(--text); display: flex; align-items: baseline; gap: 8px; }
.section-title .sub { font-size: 11px; font-weight: 400; color: var(--text-dim); }
.section-title.danger { color: #f44747; }
.super-hint {
  font-size: 12px; color: var(--text-dim);
  padding: 10px 12px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--border);
}
.proj-checks { display: flex; flex-direction: column; gap: 4px; }
.proj-check {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border); background: var(--surface);
  transition: border-color .12s;
}
.proj-check:hover { border-color: var(--text-dim); }
.proj-check.on { border-color: var(--glow-dim); }
.proj-check input[type="checkbox"] { accent-color: #22ee66; cursor: pointer; }
.p-name { font-size: 12.5px; color: var(--text); font-weight: 600; }
.p-note { font-size: 11px; color: var(--text-dim); }
.p-root { margin-left: auto; font-size: 10.5px; color: var(--text-dim); font-family: var(--font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.warn {
  font-size: 11px; color: #e2b93d; padding: 6px 10px;
  background: rgba(226,185,61,0.08); border: 1px solid rgba(226,185,61,0.25); border-radius: 6px;
}

.form-row { display: flex; gap: 8px; align-items: center; }
.form-row.col { flex-direction: column; align-items: stretch; gap: 6px; }
.form-row .f-input { flex: 1; }
.f-label { font-size: 11px; color: var(--text-dim); }
.f-input {
  padding: 8px 10px; font-size: 12px; background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; outline: none;
}
.f-input:focus { border-color: var(--glow-dim); }
.f-input.mono { font-family: var(--font); }

.btn-row { display: flex; justify-content: flex-end; }
button.primary { padding: 8px 18px; font-size: 12px; border-radius: 4px; cursor: pointer; background: var(--glow-dim); color: var(--text); border: 1px solid var(--glow); }
button.primary:disabled { opacity: .5; cursor: default; }
button.ghost { padding: 8px 14px; font-size: 12px; border-radius: 4px; cursor: pointer; background: transparent; color: var(--text-dim); border: 1px solid var(--border); white-space: nowrap; }
button.ghost:hover:not(:disabled) { color: var(--text); border-color: var(--text-dim); }
button.ghost:disabled { opacity: .5; cursor: default; }
.danger-btn {
  align-self: flex-start; padding: 7px 14px; font-size: 12px; border-radius: 4px;
  cursor: pointer; background: transparent; color: #f44747; border: 1px solid #f44747;
}
.danger-btn:hover:not(:disabled) { background: rgba(244,71,71,0.1); }
.danger-btn:disabled { opacity: .4; cursor: not-allowed; }

.err { font-size: 11px; color: #f44747; }
.ok { font-size: 11px; color: var(--glow); }
.empty { font-size: 12px; color: var(--text-dim); text-align: center; padding: 14px 0; }
.empty.big { display: flex; align-items: center; justify-content: center; min-height: 320px; }
</style>
