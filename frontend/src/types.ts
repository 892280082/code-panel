// ── Shared types (mirrors backend types.ts) ──────────────

/** 日志条目(来自某项目 logs.yaml;platform 分组,side=后端/前端) */
export interface LogEntry {
  name: string
  file: string
  platform?: string
  side?: string
  port?: number
  start?: string
  stop?: string
  exists?: boolean
  size?: number
  active?: boolean
  alive?: boolean
}

/** 项目注册表条目 */
export interface ProjectInfo {
  id: string
  name: string
  root: string
  note?: string
}

export interface DbConnection {
  id: string
  name: string
  type: 'mysql' | 'sqlite'
  version: string
  group?: string
  host?: string
  port?: number
  database?: string
  path?: string
  notes?: string
  hasPassword: boolean
  alive: boolean
  lastCheck: number | null
  serverVersion: string | null
  healthError: string | null
}

export interface DbConnectionParams {
  type: 'mysql' | 'sqlite'
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  path?: string
}

export interface SqlJob {
  id: string
  sql: string
  reason: string
  title?: string
  dbId: string
  /** 内联连接参数 */
  connection?: DbConnectionParams
  status: 'pending' | 'executed' | 'rejected' | 'failed'
  submittedAt: number
  reviewedAt?: number
  rejectReason?: string
  result?: SqlResult
  error?: string
}

export interface SqlResult {
  rows?: Record<string, unknown>[]
  affectedRows?: number
  insertId?: number
  changes?: number
  executionTime: number
}

export interface SqlHistoryEntry {
  id: string
  title: string            // ★ 标题：为什么查/改这次数据库
  sql: string
  dbId: string
  dbLabel?: string
  result: SqlResult
  executedAt: number
}

export interface SseMessage {
  file: string
  name: string
  exists: boolean
  content: string
  changed: boolean
  timestamp: number
  project?: string
}

export interface PortStatusMessage {
  type: 'port-status'
  ports: Record<number, boolean>
}

// ── Redis 管理 ──────────────────────────────────────────

export interface RedisConnection {
  id: string
  name: string
  host?: string
  port?: number
  password?: string
  db?: number
  notes?: string
  hasPassword?: boolean
  alive?: boolean
  version?: string | null
  healthError?: string | null
}

export interface RedisInfoSummary {
  version: string
  os: string
  role: string
  uptimeDays: number
  clients: { connected: number; blocked: number; max: number }
  memory: {
    usedBytes: number; usedHuman: string
    maxBytes: number; maxHuman: string
    peakBytes: number
    fragmentationRatio: number
    policy: string
  }
  hitRate: { hits: number; misses: number; rate: number }
  opsPerSec: number
  evictedKeys: number
  keyspace: { db: number; keys: number; expires: number; avgTtlMs: number }[]
  maxDatabases: number
  rdbLastSaveTs: number
  aofEnabled: number
}

export interface RedisKeyMeta { key: string; type: string; ttlMs: number; sizeBytes: number | null }

export interface RedisKeyDetail {
  key: string; type: string; ttlMs: number; encoding: string; sizeBytes: number | null
  length: number
  value: unknown; truncated: boolean
}

export interface RedisHistoryEntry {
  id: string; connId: string; db?: number
  action: string; target?: string; count?: number
  result: string; executedAt: number; via?: 'direct' | 'review'
}
