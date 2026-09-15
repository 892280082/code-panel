<script setup lang="ts">
// ── 账号面板(内容区;嵌入 ⚙ 配置「账号」Tab)────────────────
//   从 GlobalConfigModal 内联部分抽出:用户管理(仅超管,复用 UsersPanel)
//   + 当前账号信息 + 修改密码(折叠卡片)+ 退出登录。
//   登出后 emit('close') 由弹窗外壳接管关闭(避免弹窗残留在登录页上)。

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch, errText } from '@/utils/api-fetch'
import { useAuthStore } from '@/stores/auth'
import UsersPanel from '@/components/UsersPanel.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
const auth = useAuthStore()
const router = useRouter()

// ── 修改密码 ────────────────────────────────────────────
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
  } catch (e) {
    pwdErr.value = errText(e, '修改失败')
  } finally {
    pwdBusy.value = false
  }
}

async function logout() {
  await auth.logout()
  emit('close')
  router.push('/login')
}
</script>

<template>
  <!-- 用户管理(仅超管):左用户列表 / 右详情编辑 -->
  <UsersPanel v-if="auth.isSuper" />
  <div v-if="auth.isSuper" class="divider" />

  <div class="acct-line">
    当前账号:<b>{{ auth.username }}</b>
    <span class="role-tag" :class="auth.role">{{ auth.role === 'superadmin' ? '超级管理员' : '成员' }}</span>
  </div>

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
</template>

<style scoped>
.err { font-size: 11px; color: var(--danger); }
.ok { font-size: 11px; color: var(--glow); }
.divider { border-top: 1px solid var(--border); margin: 10px 0; }

.acct-line { font-size: 12px; color: var(--text-dim); }
.role-tag {
  margin-left: 6px; font-size: 10px; padding: 1px 8px; border-radius: 8px;
  border: 1px solid var(--border); color: var(--text-dim);
}
.role-tag.superadmin { color: var(--glow); border-color: var(--glow-dim); }
.role-tag.user { color: var(--info); border-color: rgba(68,153,238,0.3); }
.acct-card { border: 1px solid var(--border); background: var(--bg); border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: border-color .15s; }
.acct-card:hover { border-color: var(--text-dim); }
.acct-card-head { display: flex; align-items: center; justify-content: space-between; }
.acct-card-title { font-size: 13px; font-weight: 600; color: var(--text); }
.chev { color: var(--text-dim); font-size: 12px; }
.pwd-form { margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.pwd-btns { display: flex; justify-content: flex-end; gap: 8px; }
.acct-grid { display: flex; gap: 8px; }
.acct-grid .f-input { flex: 1; }

.danger-btn { align-self: flex-start; padding: 8px 20px; font-size: 12px; border-radius: 4px; cursor: pointer; background: transparent; color: var(--danger); border: 1px solid var(--danger); }
.danger-btn:hover { background: rgba(var(--danger-rgb),0.1); }
</style>
