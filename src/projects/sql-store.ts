// ── SQL 运行时数据(随项目):.code-panel/data/sql-history.json + sql-queue.json ──
//   语义沿用旧 src/sql-history.ts / src/sql-queue.ts(新条目插最前、历史保留 200 条)。

import crypto from 'crypto';
import type { ProjectRow } from '../db/global-store';
import { readRuntimeJson, writeRuntimeJson } from './project-store';
import type {
  SqlHistoryEntry, SqlResult, DbConnectionParams, SqlJob, SqlJobStatus, RedisJobPayload,
} from '../types';

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ── 历史 ────────────────────────────────────────────────

const HISTORY_MAX = 200;

export function historyList(project: ProjectRow, limit = 50): SqlHistoryEntry[] {
  return readRuntimeJson<SqlHistoryEntry[]>(project, 'sql-history.json', []).slice(0, limit);
}

export function historyGet(project: ProjectRow, id: string): SqlHistoryEntry | undefined {
  return readRuntimeJson<SqlHistoryEntry[]>(project, 'sql-history.json', []).find(h => h.id === id);
}

export interface HistoryAddInput {
  title: string;
  sql: string;
  dbId: string;
  dbLabel?: string;
  result: SqlResult;
  connection?: DbConnectionParams;
}

export function historyAdd(project: ProjectRow, input: HistoryAddInput): SqlHistoryEntry {
  const list = readRuntimeJson<SqlHistoryEntry[]>(project, 'sql-history.json', []);
  const entry: SqlHistoryEntry = {
    id: generateId(),
    title: input.title,
    sql: input.sql,
    dbId: input.dbId,
    dbLabel: input.dbLabel,
    connection: input.connection,
    result: input.result,
    executedAt: Date.now(),
  };
  list.unshift(entry);
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  writeRuntimeJson(project, 'sql-history.json', list);
  return entry;
}

// ── 审批队列 ─────────────────────────────────────────────

export function queueList(project: ProjectRow, status?: SqlJobStatus): SqlJob[] {
  const queue = readRuntimeJson<SqlJob[]>(project, 'sql-queue.json', []);
  if (!status) return queue;
  return queue.filter(j => j.status === status);
}

export interface QueueAddInput {
  sql: string;
  reason: string;
  dbId: string;
  title?: string;
  connection?: DbConnectionParams;
  /** 任务类型(缺省 sql;redis = Redis 危险操作走同一审批队列) */
  kind?: 'sql' | 'redis';
  /** kind=redis 的执行载荷 */
  redis?: RedisJobPayload;
}

export function queueAdd(project: ProjectRow, input: QueueAddInput): SqlJob {
  const queue = readRuntimeJson<SqlJob[]>(project, 'sql-queue.json', []);
  const job: SqlJob = {
    id: generateId(),
    sql: input.sql,
    reason: input.reason,
    title: input.title,
    dbId: input.dbId,
    connection: input.connection,
    kind: input.kind,
    redis: input.redis,
    status: 'pending',
    submittedAt: Date.now(),
  };
  queue.unshift(job);
  writeRuntimeJson(project, 'sql-queue.json', queue);
  return job;
}

export function queueGet(project: ProjectRow, id: string): SqlJob | undefined {
  return readRuntimeJson<SqlJob[]>(project, 'sql-queue.json', []).find(j => j.id === id);
}

export function queueUpdate(
  project: ProjectRow,
  id: string,
  updates: Partial<Pick<SqlJob, 'status' | 'reviewedAt' | 'rejectReason' | 'result' | 'error' | 'connection'>>,
): SqlJob | null {
  const queue = readRuntimeJson<SqlJob[]>(project, 'sql-queue.json', []);
  const job = queue.find(j => j.id === id);
  if (!job) return null;
  Object.assign(job, updates);
  writeRuntimeJson(project, 'sql-queue.json', queue);
  return job;
}
