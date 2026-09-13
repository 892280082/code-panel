// ── GLM Coding Plan 额度(智谱)store ──────────────────────
//   两个开关 + 轮询,开关为 UI 偏好存 localStorage(对齐快捷键/FAB 位置的模式)。
//   数据来自 GET /api/llm/glm-quota(后端代理官方 monitor 接口,Key 不出服务端)。
//   消费方:LlmPanel(⚙ → 模型,两开关 + 大进度条)/ GlmPlanGauges(顶栏迷你仪表盘)。

import { defineStore } from 'pinia'
import { apiJson } from '@/utils/api-fetch'

export interface GlmPool {
  key: string; label: string
  used: number; total: number; remaining: number
  percent: number   // 已用 %
  resetAt: number   // 重置时间戳(ms)
}

export interface GlmQuota {
  providerId: string; providerName: string
  level: string
  pools: GlmPool[]
  fetchedAt: number
}

const LS_QUERY = 'glm-plan-query'    // 开启 Plan 查询
const LS_TOPBAR = 'glm-plan-topbar'  // 顶栏迷你仪表盘
const POLL_MS = 60_000               // 1 分钟一轮(2026-09-13 用户定:进度要跟得上)

let timer: ReturnType<typeof setInterval> | null = null

/** 重置时间戳 → "X小时Y分后重置"(已过期 → "已重置";Gauges/LlmPanel 共用) */
export function countdown(resetAt: number): string {
  const ms = resetAt - Date.now()
  if (ms <= 0) return '已重置'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}小时${m}分后重置` : `${Math.max(m, 1)}分后重置`
}

/** 用量百分比 → 颜色(对齐 SystemResourceMonitor 阈值:90红/70橙/其余绿) */
export function usageColor(percent: number): string {
  if (percent >= 90) return '#f44747'
  if (percent >= 70) return '#f0a030'
  return '#22ee66'
}

export const useGlmPlanStore = defineStore('glmPlan', {
  state: () => ({
    enabled: false,        // 开启 Plan 查询
    topbar: false,         // 右上角迷你仪表盘
    quota: null as GlmQuota | null,
    err: '',
    loading: false,
    inited: false,
  }),
  getters: {
    pool5h: (s) => s.quota?.pools.find(p => p.key === '5h') ?? null,
    poolWeek: (s) => s.quota?.pools.find(p => p.key === 'week') ?? null,
  },
  actions: {
    /** 各视图最早挂载处调用一次:恢复开关,开了就拉数据 + 起轮询 */
    init() {
      if (this.inited) return
      this.inited = true
      try {
        this.enabled = localStorage.getItem(LS_QUERY) === '1'
        this.topbar = localStorage.getItem(LS_TOPBAR) === '1'
      } catch { /* ignore */ }
      if (this.enabled) this.ensurePolling()
    },
    setEnabled(v: boolean) {
      this.enabled = v
      try { localStorage.setItem(LS_QUERY, v ? '1' : '0') } catch { /* ignore */ }
      if (v) this.ensurePolling()
      else { this.stopPolling(); this.quota = null; this.err = '' }
    },
    setTopbar(v: boolean) {
      this.topbar = v
      try { localStorage.setItem(LS_TOPBAR, v ? '1' : '0') } catch { /* ignore */ }
    },
    ensurePolling() {
      if (timer) return
      this.refresh()  // 开启即查一次,别等第一轮
      timer = setInterval(() => { this.refresh() }, POLL_MS)
    },
    stopPolling() {
      if (timer) { clearInterval(timer); timer = null }
    },
    async refresh() {
      if (this.loading) return
      this.loading = true
      try {
        const res = await apiJson<{ data: GlmQuota }>('/api/llm/glm-quota')
        this.quota = res.data
        this.err = ''
      } catch (e: unknown) {
        // 查询失败保留旧数据(仪表盘不至于闪空),只记错误
        this.err = e instanceof Error && e.message ? e.message : '查询失败'
      } finally {
        this.loading = false
      }
    },
  },
})
