// ── LLM 供应商(模型)store ────────────────────────────────
//   快照唯一真源:providers + active + rc/settings 状态全部来自 GET /api/llm/providers。
//   消费方:ProviderSwitcher(右上切换)/ LlmPanel(⚙ 配置 → 模型)。

import { defineStore } from 'pinia'
import { apiJson } from '@/utils/api-fetch'

/** 一行变量(结构化渲染用) */
export interface LlmVarEntry {
  key: string
  /** 脱敏后的值:敏感键 → ****尾4;未填的占位符原样 <...> */
  value: string
  /** 敏感键(TOKEN/KEY/SECRET/PASSWORD)→ 密码框 + 👁 */
  sensitive: boolean
  /** 还是模板占位符,没填真值 */
  unfilled: boolean
}

export interface LlmProvider {
  id: string
  name: string
  /** 已脱敏:敏感值(含 TOKEN/KEY 字样)显示 ****尾4;编辑保存时带 **** 的值 = 保留旧值 */
  vars: string
  /** 结构化变量行(前端表单直接用) */
  entries: LlmVarEntry[]
  enabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  varCount: number
  baseUrl: string
  tokenTail: string
  /** 未填写的占位符键名(有值时后端会拒绝激活) */
  unfilledKeys: string[]
}

export interface LlmSnapshotData {
  providers: LlmProvider[]
  active: { providerId: string | null; name: string | null }
  envFile: string
  rc: string
  rcMounted: boolean
  settingsFile: string
  /** settings.json 里存在但不受面板管的第三方键(可能压过面板配置) */
  foreignKeys: string[]
}

export const useLlmStore = defineStore('llm', {
  state: () => ({
    providers: [] as LlmProvider[],
    activeId: null as string | null,
    activeName: null as string | null,
    envFile: '',
    rc: '',
    rcMounted: false,
    settingsFile: '',
    foreignKeys: [] as string[],
    loaded: false,
  }),
  getters: {
    /** 右上角切换器只列「已启用」的供应商 */
    enabledProviders: (s) => s.providers.filter(p => p.enabled),
    activeProvider: (s) => s.providers.find(p => p.id === s.activeId) ?? null,
  },
  actions: {
    apply(s: LlmSnapshotData | undefined | null) {
      if (!s) return
      this.providers = Array.isArray(s.providers) ? s.providers : []
      this.activeId = s.active?.providerId ?? null
      this.activeName = s.active?.name ?? null
      this.envFile = s.envFile || ''
      this.rc = s.rc || ''
      this.rcMounted = !!s.rcMounted
      this.settingsFile = s.settingsFile || ''
      this.foreignKeys = Array.isArray(s.foreignKeys) ? s.foreignKeys : []
      this.loaded = true
    },
    async load() {
      const res = await apiJson<{ data: LlmSnapshotData }>('/api/llm/providers')
      this.apply(res.data)
    },
    /** 选用某供应商;null = 不注入(官方登录态) */
    async activate(providerId: string | null) {
      const res = await apiJson<{ data: LlmSnapshotData }>('/api/llm/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })
      this.apply(res.data)
    },
    /** 新增;返回快照 */
    async addProvider(payload: { name: string; vars: string; enabled?: boolean }) {
      const res = await apiJson<{ data: LlmSnapshotData }>('/api/llm/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      this.apply(res.data)
    },
    /** 更新(vars 不传 = 不动;带 **** 的值由后端保留旧值) */
    async updateProvider(id: string, payload: { name?: string; vars?: string; enabled?: boolean }) {
      const res = await apiJson<{ data: LlmSnapshotData }>(`/api/llm/providers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      this.apply(res.data)
    },
    async removeProvider(id: string) {
      const res = await apiJson<{ data: LlmSnapshotData }>(`/api/llm/providers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      this.apply(res.data)
    },
    /** 明文读取(vars 原文;仅超管;UI 点👁 时才拉,平时只有脱敏值) */
    async reveal(id: string): Promise<string> {
      const res = await apiJson<{ data: { vars: string } }>(
        `/api/llm/providers/${encodeURIComponent(id)}/reveal`,
      )
      return res.data?.vars ?? ''
    },
  },
})
