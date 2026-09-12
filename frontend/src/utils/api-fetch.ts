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
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error(`响应解析失败 (HTTP ${res.status})`)
  }
  if (data && typeof data === 'object' && 'ok' in data && data.ok === false) {
    const error = 'error' in data ? String(data.error) : ''
    throw new Error(error || `请求失败 (HTTP ${res.status})`)
  }
  return data as T
}

/** 未知异常 → 展示文案(Error 取 message;其余/空 message 用 fallback) */
export function errText(e: unknown, fallback = '请求失败'): string {
  return e instanceof Error && e.message ? e.message : fallback
}
