// ── Redis store(按当前项目作用域) ─────────────────────────
// 职责:连接列表、概览信息、key 浏览(SCAN 分页)、key 详情、TTL/删除/FLUSH 操作。
// 所有接口带 ?project=<id>;切换项目自动重载(照 sql.ts 模式)。

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { apiJson } from '@/utils/api-fetch'
import { useProjectsStore } from './projects'
import type {
  RedisConnection, RedisInfoSummary, RedisKeyMeta, RedisKeyDetail, RedisHistoryEntry,
} from '@/types'

export const useRedisStore = defineStore('redis', () => {
  const projects = useProjectsStore()

  // ── State ──────────────────────────────────────────────
  const connections = ref<RedisConnection[]>([])
  const selectedId = ref('')
  const info = ref<RedisInfoSummary | null>(null)
  const infoLoading = ref(false)

  const currentDb = ref<number | null>(null)      // null = 用连接默认 db
  const cursor = ref('0')
  const nextCursor = ref('0')
  const match = ref('*')
  const keys = ref<RedisKeyMeta[]>([])
  const keysLoading = ref(false)

  const detail = ref<RedisKeyDetail | null>(null)
  const detailLoading = ref(false)
  const checked = ref<Set<string>>(new Set())

  const history = ref<RedisHistoryEntry[]>([])
  const lastError = ref('')

  const qs = () => `project=${projects.currentProject?.id ?? ''}`
  const current = () => connections.value.find(c => c.id === selectedId.value)

  function dbParam(): string {
    const db = currentDb.value ?? current()?.db ?? 0
    return `&db=${db}`
  }

  // ── 加载 ───────────────────────────────────────────────
  async function loadConnections(): Promise<void> {
    try {
      const r = await apiJson<{ data: RedisConnection[] }>(`/api/redis?${qs()}`)
      connections.value = r.data
      if (!selectedId.value || !connections.value.some(c => c.id === selectedId.value)) {
        selectedId.value = connections.value[0]?.id ?? ''
      }
      await Promise.all([loadInfo(), loadKeys(true), loadHistory()])
    } catch (e) { lastError.value = (e as Error).message }
  }

  async function loadInfo(): Promise<void> {
    if (!selectedId.value) { info.value = null; return }
    infoLoading.value = true
    try {
      const r = await apiJson<{ data: RedisInfoSummary }>(`/api/redis/${selectedId.value}/info?${qs()}${dbParam()}`)
      info.value = r.data
    } catch (e) { info.value = null; lastError.value = (e as Error).message }
    finally { infoLoading.value = false }
  }

  async function loadKeys(reset = false): Promise<void> {
    if (!selectedId.value) { keys.value = []; return }
    keysLoading.value = true
    try {
      if (reset) cursor.value = '0'
      const r = await apiJson<{ data: { cursor: string; keys: RedisKeyMeta[] } }>(
        `/api/redis/${selectedId.value}/keys?${qs()}${dbParam()}&cursor=${cursor.value}&match=${encodeURIComponent(match.value)}&count=100`)
      keys.value = r.data.keys
      nextCursor.value = r.data.cursor
      checked.value = new Set()
    } catch (e) { lastError.value = (e as Error).message }
    finally { keysLoading.value = false }
  }

  async function loadDetail(key: string): Promise<void> {
    detailLoading.value = true
    try {
      const r = await apiJson<{ data: RedisKeyDetail }>(`/api/redis/${selectedId.value}/key?${qs()}${dbParam()}&key=${encodeURIComponent(key)}`)
      detail.value = r.data
    } catch (e) { detail.value = null; lastError.value = (e as Error).message }
    finally { detailLoading.value = false }
  }

  async function loadHistory(): Promise<void> {
    if (!selectedId.value) { history.value = []; return }
    try {
      const r = await apiJson<{ data: RedisHistoryEntry[] }>(`/api/redis/${selectedId.value}/history?${qs()}`)
      history.value = r.data
    } catch { history.value = [] }
  }

  // ── 操作 ───────────────────────────────────────────────
  async function setTtl(key: string, ttl: number): Promise<void> {
    await apiJson(`/api/redis/${selectedId.value}/ttl?${qs()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: currentDb.value ?? current()?.db ?? 0, key, ttl }),
    })
    await Promise.all([loadDetail(key), loadKeys()])
  }

  async function deleteKey(key: string): Promise<void> {
    await apiJson(`/api/redis/${selectedId.value}/key?${qs()}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: currentDb.value ?? current()?.db ?? 0, key }),
    })
    if (detail.value?.key === key) detail.value = null
    await Promise.all([loadKeys(), loadInfo(), loadHistory()])
  }

  async function deleteChecked(): Promise<{ queued: boolean; jobId?: string; affected?: number }> {
    const ks = [...checked.value]
    const r = await apiJson<{ data: { queued: boolean; jobId?: string; affected?: number } }>(
      `/api/redis/${selectedId.value}/keys/delete?${qs()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: currentDb.value ?? current()?.db ?? 0, keys: ks }),
      })
    await Promise.all([loadKeys(), loadInfo(), loadHistory()])
    return r.data
  }

  async function deleteByMatch(m: string): Promise<{ queued: boolean; jobId?: string; matched?: number }> {
    const r = await apiJson<{ data: { queued: boolean; jobId?: string; matched?: number } }>(
      `/api/redis/${selectedId.value}/keys/delete?${qs()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: currentDb.value ?? current()?.db ?? 0, match: m }),
      })
    await Promise.all([loadKeys(), loadInfo(), loadHistory()])
    return r.data
  }

  async function flushdb(): Promise<{ queued: boolean; jobId?: string }> {
    const r = await apiJson<{ data: { queued: boolean; jobId?: string } }>(
      `/api/redis/${selectedId.value}/flushdb?${qs()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: currentDb.value ?? current()?.db ?? 0, confirm: 'FLUSHDB' }),
      })
    await Promise.all([loadKeys(true), loadInfo(), loadHistory()])
    return r.data
  }

  async function flushall(): Promise<{ queued: boolean; jobId?: string }> {
    const r = await apiJson<{ data: { queued: boolean; jobId?: string } }>(
      `/api/redis/${selectedId.value}/flushall?${qs()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'FLUSHALL' }),
      })
    await Promise.all([loadKeys(true), loadInfo(), loadHistory()])
    return r.data
  }

  // ── 切换 ───────────────────────────────────────────────
  function select(id: string): void {
    selectedId.value = id
    currentDb.value = null
    detail.value = null
    void loadInfo(); void loadKeys(true); void loadHistory()
  }

  function selectDb(db: number | null): void {
    currentDb.value = db
    detail.value = null
    void loadInfo(); void loadKeys(true)
  }

  // 项目切换重载
  watch(() => projects.currentProject?.id, () => {
    selectedId.value = ''
    connections.value = []
    info.value = null
    keys.value = []
    detail.value = null
    void loadConnections()
  })

  function init(): void {
    void loadConnections()
  }

  return {
    connections, selectedId, info, infoLoading,
    currentDb, cursor, nextCursor, match, keys, keysLoading,
    detail, detailLoading, checked, history, lastError,
    loadConnections, loadInfo, loadKeys, loadDetail, loadHistory,
    setTtl, deleteKey, deleteChecked, deleteByMatch, flushdb, flushall,
    select, selectDb, init,
  }
})
