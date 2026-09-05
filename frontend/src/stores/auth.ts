// ── Auth Store (Pinia) ──────────────────────────────────
//   JWT 存储、登录/登出、API 注入。
//   「记住我」语义 = 记住登录态:
//     勾选 → token 存 localStorage(刷新/重开浏览器免登录)
//     不勾 → token 存 sessionStorage(关标签即登出)
//   登录同时由服务端种 cp_auth cookie(子资源/SSE 通道)。

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const TOKEN_KEY = 'cp_token'
const USER_KEY = 'cp_user'

function readStorages<T>(key: string): T | null {
  const v = sessionStorage.getItem(key) ?? localStorage.getItem(key)
  return v as T | null
}
function writeStorage(key: string, value: string, remember: boolean) {
  const s = remember ? localStorage : sessionStorage
  const other = remember ? sessionStorage : localStorage
  s.setItem(key, value)
  other.removeItem(key)
}
function clearStorages(key: string) {
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(readStorages<string>(TOKEN_KEY))
  const username = ref<string | null>(readStorages<string>(USER_KEY))

  const isLoggedIn = computed(() => !!token.value)

  /** 登录:成功后按 remember 决定持久化位置 */
  async function login(user: string, pwd: string, remember: boolean): Promise<string> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pwd, remember }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || `登录失败 (HTTP ${res.status})`)
    token.value = data.token
    username.value = data.username
    writeStorage(TOKEN_KEY, data.token, remember)
    writeStorage(USER_KEY, data.username, remember)
    return data.token
  }

  /** 登出:清本地 + 通知服务端清 cookie */
  async function logout() {
    token.value = null
    username.value = null
    clearStorages(TOKEN_KEY)
    clearStorages(USER_KEY)
    try {
      await fetch('/api/auth/logout', { method: 'POST' }) // cookie 由服务端清(尽力而为)
    } catch { /* ignore */ }
  }

  /** 恢复登录态/校验过期(每次导航调用) */
  function checkAuth(): boolean {
    const t = readStorages<string>(TOKEN_KEY)
    if (t) {
      token.value = t
      username.value = readStorages<string>(USER_KEY)
      try {
        const payload = JSON.parse(atob(t.split('.')[1]))
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          logout()
          return false
        }
      } catch { /* 格式异常,保留由服务端校验 */ }
      return true
    }
    token.value = null
    username.value = null
    return false
  }

  /** API fetch wrapper:注入 Bearer;401 时登出并跳登录 */
  async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    }
    if (token.value) headers['Authorization'] = `Bearer ${token.value}`
    const res = await fetch(url, { ...options, headers })
    if (res.status === 401 && !url.includes('/api/auth/login')) {
      logout()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname)
      }
    }
    return res
  }

  return { token, username, isLoggedIn, login, logout, checkAuth, apiFetch }
})
