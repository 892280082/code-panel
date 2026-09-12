<script setup lang="ts">
import { ref } from 'vue'
import { errText } from '@/utils/api-fetch'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const remember = ref(true) // 默认勾选(本地工具,记住登录态)
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!username.value || !password.value) {
    error.value = '请输入账号和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await auth.login(username.value.trim(), password.value, remember.value)
    const redirect = (route.query.redirect as string) || '/log'
    router.push(redirect)
  } catch (e) {
    error.value = errText(e, '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-form" @submit.prevent="handleLogin">
      <h1>Code Panel</h1>
      <p class="subtitle">运维控制面板 · JWT 登录</p>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <label>
        <span>账号</span>
        <input v-model="username" type="text" placeholder="请输入账号" autocomplete="username" :disabled="loading" />
      </label>

      <label>
        <span>密码</span>
        <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" :disabled="loading" />
      </label>

      <label class="remember-label">
        <input v-model="remember" type="checkbox" :disabled="loading" />
        <span>记住我（保持登录，关浏览器后仍免登录）</span>
      </label>

      <button type="submit" :disabled="loading">
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg, #0d1117);
  color: var(--text, #c9d1d9);
}

.login-form {
  width: 360px;
  max-width: 90vw;
  padding: 40px 32px;
  background: var(--surface, #161b22);
  border: 1px solid var(--border, #30363d);
  border-radius: 8px;
}

.login-form h1 { font-size: 20px; font-weight: 700; text-align: center; margin: 0 0 4px; }
.subtitle { font-size: 12px; text-align: center; color: var(--text-dim, #8b949e); margin: 0 0 24px; }
.error-msg {
  padding: 8px 12px; margin-bottom: 16px; font-size: 13px;
  background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.3);
  border-radius: 4px; color: #ff6b6b;
}
label { display: block; margin-bottom: 16px; }
label > span:first-child {
  display: block; font-size: 12px; font-weight: 600;
  color: var(--text-dim, #8b949e); margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: 0.05em;
}
input[type="text"], input[type="password"] {
  width: 100%; padding: 10px 12px; box-sizing: border-box;
  background: var(--bg, #0d1117); border: 1px solid var(--border, #30363d);
  border-radius: 4px; color: var(--text, #c9d1d9); font-size: 14px; outline: none;
}
input:focus { border-color: var(--glow-dim, #58a6ff); }
.remember-label { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
.remember-label input { width: 16px; height: 16px; margin: 0; accent-color: var(--glow-dim, #58a6ff); }
.remember-label span {
  font-size: 13px; color: var(--text-dim, #8b949e);
  text-transform: none; letter-spacing: normal; font-weight: 400;
}
button[type="submit"] {
  width: 100%; padding: 10px 0;
  background: var(--glow-dim, #238636); border: none; border-radius: 4px;
  color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
}
button[type="submit"]:hover:not(:disabled) { opacity: 0.9; }
button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
