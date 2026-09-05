// ── Shared fetch(注入 JWT;401 自动登出) ────────────────

import { useAuthStore } from '@/stores/auth'

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return useAuthStore().apiFetch(url, options)
}

/**
 * fetch + JSON 解析 + 统一错误:响应体形如 { ok:false, error } 时自动抛错。
 * 让各 store 只关心业务数据,不必反复写 `await res.json(); if(!data.ok)...`。
 */
export async function apiJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(url, options)
  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error(`响应解析失败 (HTTP ${res.status})`)
  }
  if (data && typeof data === 'object' && 'ok' in data && data.ok === false) {
    throw new Error(data.error || `请求失败 (HTTP ${res.status})`)
  }
  return data as T
}
