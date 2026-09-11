// ── 时空胶囊 store(全局唯一)────────────────────────────
//   胶囊 = AI「时空胶囊」指令写进 ~/.code-panel-capsules/ 的文档。
//   负责:列表/未读(本地)/右上角通知队列/SSE 订阅(EventSource
//   直连 /api/capsule/stream,断线靠原生重连 + onopen 拉列表对账)。

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiJson } from '@/utils/api-fetch'
import { useAuthStore } from '@/stores/auth'

export interface CapsuleEntry {
  id: string
  kind: 'file' | 'dir'
  mtime: number
  size: number
  fileCount: number
}

const READ_KEY = 'capsule:read'

function loadRead(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')) } catch { return new Set() } // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const useCapsuleStore = defineStore('capsule', () => {
  const entries = ref<CapsuleEntry[]>([])
  const dir = ref('')
  const connected = ref(false)
  /** 右上角通知队列(SSE 到达入队,15s 自动过期,最多同屏 3 张) */
  const toasts = ref<{ id: string; event: 'new' | 'update'; kind: string; ts: number }[]>([])
  const readSet = ref<Set<string>>(loadRead())
  /** 预览弹窗正打开的胶囊 id(null=关) */
  const previewId = ref<string | null>(null)

  let es: EventSource | null = null

  const unreadIds = computed(() => entries.value.filter(e => !readSet.value.has(e.id)).map(e => e.id))

  function saveRead(): void {
    try { localStorage.setItem(READ_KEY, JSON.stringify([...readSet.value])) } catch { /* ignore */ }
  }

  async function refresh(): Promise<void> {
    try {
      const res = await apiJson('/api/capsule/list')
      entries.value = res.data?.entries || []
      dir.value = res.data?.dir || ''
    } catch { /* 面板未就绪 → 保持现状 */ }
  }

  function connect(): void {
    if (es) return
    const auth = useAuthStore()
    const qs = auth.token ? `?token=${encodeURIComponent(auth.token)}` : ''
    es = new EventSource(`/api/capsule/stream${qs}`)
    es.onopen = () => {
      connected.value = true
      refresh() // 重连对账:断线窗口内的事件靠重拉列表补齐
    }
    es.onerror = () => { connected.value = false }
    es.onmessage = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data)
        if (d?.type === 'capsule' && d.capsule?.id) {
          onCapsuleEvent(d.event === 'update' ? 'update' : 'new', d.capsule as CapsuleEntry)
        }
      } catch { /* 非 JSON → 忽略 */ }
    }
  }

  function onCapsuleEvent(event: 'new' | 'update', c: CapsuleEntry): void {
    // 列表头插/更新
    const i = entries.value.findIndex(x => x.id === c.id)
    if (i >= 0) entries.value.splice(i, 1)
    entries.value.unshift(c)
    // 预览正开着同一个 → 只更新数据不打扰(弹窗有 ↻ 手动刷新)
    if (previewId.value === c.id) return
    // 通知卡片:同 id 去重置顶,最多 3 张,15s 自动过期
    const j = toasts.value.findIndex(t => t.id === c.id)
    if (j >= 0) toasts.value.splice(j, 1)
    toasts.value.unshift({ id: c.id, event, kind: c.kind, ts: Date.now() })
    if (toasts.value.length > 3) toasts.value.length = 3
    setTimeout(() => dismissToast(c.id), 15000)
  }

  function dismissToast(id: string): void {
    const i = toasts.value.findIndex(t => t.id === id)
    if (i >= 0) toasts.value.splice(i, 1)
  }

  function openPreview(id: string): void {
    previewId.value = id
    readSet.value.add(id)
    saveRead()
    dismissToast(id)
  }

  function closePreview(): void {
    previewId.value = null
  }

  /** 下拉面板打开时清未读点 */
  function clearUnread(): void {
    for (const e of entries.value) readSet.value.add(e.id)
    saveRead()
  }

  /** App 登录后调:拉列表 + 连 SSE */
  async function init(): Promise<void> {
    await refresh()
    connect()
  }

  return {
    entries, dir, connected, toasts, unreadIds, previewId, readSet,
    refresh, init, openPreview, closePreview, dismissToast, clearUnread,
  }
})
