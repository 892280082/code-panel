// ── SQL job queue — persistent review queue (memory-cached) ──

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SqlJob, SqlJobStatus, DbConnectionParams } from './types';

const QUEUE_FILE = path.join(__dirname, '..', 'sql-queue.json');

/** 生成唯一 ID */
export function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ── Memory cache ─────────────────────────────────────────
// 避免每次操作都读写文件，内存中维护队列，仅在变更时写盘

let cache: SqlJob[] | null = null;

function loadQueue(): SqlJob[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch {
    cache = [];
  }
  return cache;
}

function saveQueue(): void {
  if (!cache) return;
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/** 提交新任务 */
export function addJob(sql: string, reason: string, dbId: string, title?: string, connection?: DbConnectionParams): SqlJob {
  const queue = loadQueue();
  const job: SqlJob = {
    id: generateId(),
    sql,
    reason,
    title,
    dbId,
    connection,
    status: 'pending',
    submittedAt: Date.now(),
  };
  queue.unshift(job);
  saveQueue();
  return job;
}

/** 更新任务状态 */
export function updateJob(id: string, updates: Partial<Pick<SqlJob, 'status' | 'reviewedAt' | 'rejectReason' | 'result' | 'error' | 'connection'>>): SqlJob | null {
  const queue = loadQueue();
  const job = queue.find(j => j.id === id);
  if (!job) return null;
  Object.assign(job, updates);
  saveQueue();
  return job;
}

/** 查询单个任务 */
export function getJob(id: string): SqlJob | undefined {
  return loadQueue().find(j => j.id === id);
}

/** 查询任务列表，可按状态筛选 */
export function getJobs(status?: SqlJobStatus): SqlJob[] {
  const queue = loadQueue();
  if (!status) return queue;
  return queue.filter(j => j.status === status);
}
