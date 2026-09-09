// ── AI 查询历史记录 — 持久化 JSON 存储 ──────────────────

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SqlHistoryEntry, SqlResult, DbConnectionParams } from './types';

const HISTORY_FILE = path.join(__dirname, '..', 'sql-history.json');

let cache: SqlHistoryEntry[] | null = null;

function loadHistory(): SqlHistoryEntry[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    cache = [];
  }
  return cache ?? [];
}

function saveHistory(): void {
  if (!cache) return;
  // 只保留最近 200 条
  if (cache.length > 200) cache = cache.slice(0, 200);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** 添加一条查询历史 */
export function addHistory(
  title: string,
  sql: string,
  dbId: string,
  dbLabel: string | undefined,
  result: SqlResult,
  connection?: DbConnectionParams,
): SqlHistoryEntry {
  const list = loadHistory();
  const entry: SqlHistoryEntry = {
    id: generateId(),
    title,
    sql,
    dbId,
    dbLabel,
    connection,
    result,
    executedAt: Date.now(),
  };
  list.unshift(entry);
  saveHistory();
  return entry;
}

/** 获取历史列表（按时间倒序） */
export function getHistory(limit: number = 50): SqlHistoryEntry[] {
  return loadHistory().slice(0, limit);
}

/** 获取单条历史 */
export function getHistoryEntry(id: string): SqlHistoryEntry | undefined {
  return loadHistory().find(h => h.id === id);
}
