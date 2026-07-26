// ── Shared types (mirrors backend types.ts) ──────────────

export interface LogEntry {
  name: string
  file: string
  groupKey: string
  groupName: string
  port?: number
  exists?: boolean
  size?: number
  active?: boolean
  alive?: boolean
}

export interface LogGroup {
  name: string
  logs: { name: string; file: string; port?: number }[]
}

export interface AppConfig {
  groups: Record<string, LogGroup>
  reviewMode: boolean
}

export interface DbConnection {
  id: string
  name: string
  type: 'mysql' | 'sqlite'
  version: string
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

export interface SqlJob {
  id: string
  sql: string
  reason: string
  dbId: string
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

export interface SseMessage {
  file: string
  name: string
  exists: boolean
  content: string
  changed: boolean
  timestamp: number
}

export interface PortStatusMessage {
  type: 'port-status'
  ports: Record<number, boolean>
}
