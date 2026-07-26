// ── SQLite-backed log group / entry config store ─────────

import fs from 'fs';
import path from 'path';
import type { LogGroup, LogEntry } from './types';
import { save as saveDb } from './db/db-config-store';

const CFG_PATH = path.join(__dirname, '..', 'config.json');

let _db: import('sql.js').Database | null = null;

function db(): import('sql.js').Database {
  if (!_db) throw new Error('log-config-store: db not open — ensure db-config-store.init() ran first');
  return _db;
}

// ── Helpers ──────────────────────────────────────────────

/** 从日志名称中提取端口号，如 "main-platform (3100)" → 3100 */
function extractPort(name: string): number | null {
  const m = name.match(/\((\d+)\)/);
  return m ? parseInt(m[1]) : null;
}

// ── Init tables (called from db-config-store.init) ──────

export function initTables(): void {
  const d = db();
  d.run(`
    CREATE TABLE IF NOT EXISTS log_groups (
      group_key  TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  d.run(`
    CREATE TABLE IF NOT EXISTS log_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key  TEXT NOT NULL,
      name       TEXT NOT NULL,
      file       TEXT NOT NULL,
      port       INTEGER DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 升级旧表：添加 port 列（如果不存在）
  try { d.run('ALTER TABLE log_entries ADD COLUMN port INTEGER DEFAULT NULL'); } catch { /* 已存在 */ }

  // 自动从名称提取 port（仅填充 port 为 NULL 的条目，不覆盖用户手动设置的值）
  const result = d.exec('SELECT id, name FROM log_entries WHERE port IS NULL');
  if (result.length) {
    for (const row of result[0].values) {
      const id = row[0] as number;
      const name = row[1] as string;
      const port = extractPort(name);
      if (port !== null) {
        d.run('UPDATE log_entries SET port = ? WHERE id = ?', [port, id]);
      }
    }
  }

  // 从 config.json 迁移（批量操作，最后一次性 saveDb）
  let migrated = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.groups && Object.keys(cfg.groups).length > 0) {
      const count = Object.keys(cfg.groups).length;
      for (const [gk, gv] of Object.entries(cfg.groups)) {
        const group = gv as LogGroup;
        upsertGroup(gk, group.name, false);
        for (let i = 0; i < (group.logs || []).length; i++) {
          const log = group.logs[i];
          addLogEntry(gk, log.name, log.file, i, false);
        }
      }
      delete cfg.groups;
      fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
      console.log(`  migrated ${count} log groups`);
      migrated = true;
    }
  } catch { /* config.json may not exist */ }

  if (migrated) saveDb();
}

/** 设置 db 引用（由 db-config-store 初始化后调用） */
export function setDb(database: import('sql.js').Database): void {
  _db = database;
}

// ── Group CRUD ───────────────────────────────────────────

export function listGroups(): { groupKey: string; name: string }[] {
  const result = db().exec('SELECT group_key, name FROM log_groups ORDER BY created_at');
  if (!result.length) return [];
  return result[0].values.map(row => ({ groupKey: row[0] as string, name: row[1] as string }));
}

export function getGroup(key: string): { groupKey: string; name: string } | undefined {
  const stmt = db().prepare('SELECT group_key, name FROM log_groups WHERE group_key = ?');
  stmt.bind([key]);
  let r: { groupKey: string; name: string } | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject();
    r = { groupKey: o.group_key as string, name: o.name as string };
  }
  stmt.free();
  return r;
}

function upsertGroup(key: string, name: string, autoSave = true): void {
  const existing = getGroup(key);
  const now = Date.now();
  if (existing) {
    db().run('UPDATE log_groups SET name = ?, updated_at = ? WHERE group_key = ?', [name, now, key]);
  } else {
    db().run('INSERT INTO log_groups (group_key, name, created_at, updated_at) VALUES (?,?,?,?)', [key, name, now, now]);
  }
  if (autoSave) saveDb();
}

export function addGroup(key: string, name: string, logs?: { name: string; file: string }[]): void {
  if (getGroup(key)) throw new Error(`Log group "${key}" already exists`);
  upsertGroup(key, name, false);
  if (logs) {
    logs.forEach((l, i) => addLogEntry(key, l.name, l.file, i, false));
  }
  saveDb();
}

export function updateGroup(key: string, name: string): void {
  if (!getGroup(key)) throw new Error(`Log group "${key}" not found`);
  upsertGroup(key, name);
}

export function deleteGroup(key: string): void {
  db().run('DELETE FROM log_entries WHERE group_key = ?', [key]);
  db().run('DELETE FROM log_groups WHERE group_key = ?', [key]);
  saveDb();
}

// ── Log entry CRUD ──────────────────────────────────────

export function listEntries(groupKey: string): Array<{ id: number; name: string; file: string; port: number | null }> {
  const result = db().exec('SELECT id, name, file, port FROM log_entries WHERE group_key = ? ORDER BY sort_order, id', [groupKey]);
  if (!result.length) return [];
  return result[0].values.map(row => ({ id: row[0] as number, name: row[1] as string, file: row[2] as string, port: (row[3] as number) || null }));
}

function addLogEntry(groupKey: string, name: string, file: string, sortOrder?: number, autoSave = true): number {
  const now = Date.now();
  const order = sortOrder ?? listEntries(groupKey).length;
  const port = extractPort(name);
  db().run(
    'INSERT INTO log_entries (group_key, name, file, port, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [groupKey, name, file, port, order, now, now],
  );
  if (autoSave) saveDb();
  const r = db().exec('SELECT last_insert_rowid()');
  return (r[0]?.values?.[0]?.[0] as number) || 0;
}

export function addEntry(groupKey: string, name: string, file: string, port?: number): { id: number } {
  if (!getGroup(groupKey)) throw new Error(`Log group "${groupKey}" not found`);
  const effectivePort = port ?? extractPort(name) ?? undefined;
  const now = Date.now();
  const order = listEntries(groupKey).length;
  db().run(
    'INSERT INTO log_entries (group_key, name, file, port, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [groupKey, name, file, effectivePort ?? null, order, now, now],
  );
  saveDb();
  const r = db().exec('SELECT last_insert_rowid()');
  return { id: (r[0]?.values?.[0]?.[0] as number) || 0 };
}

export function updateEntry(entryId: number, updates: { name?: string; file?: string; port?: number | null }): void {
  const existing = db().exec('SELECT id FROM log_entries WHERE id = ?', [entryId]);
  if (!existing.length || !existing[0].values.length) throw new Error(`Log entry ${entryId} not found`);

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (updates.name !== undefined) {
    sets.push('name = ?'); vals.push(updates.name);
    // 名称变更时自动更新 port
    if (updates.port === undefined) {
      const p = extractPort(updates.name);
      sets.push('port = ?'); vals.push(p);
    }
  }
  if (updates.file !== undefined) { sets.push('file = ?'); vals.push(updates.file); }
  if (updates.port !== undefined) { sets.push('port = ?'); vals.push(updates.port); }
  if (!sets.length) return;
  sets.push('updated_at = ?'); vals.push(Date.now());
  vals.push(entryId);
  db().run(`UPDATE log_entries SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDb();
}

export function deleteEntry(entryId: number): void {
  db().run('DELETE FROM log_entries WHERE id = ?', [entryId]);
  saveDb();
}

// ── Get all (for log-monitor) — single JOIN queries ─────

export function getAllGroupsAndLogs(): Record<string, LogGroup> {
  const result: Record<string, LogGroup> = {};
  const sql = `
    SELECT g.group_key, g.name AS group_name, e.id AS entry_id, e.name AS entry_name, e.file, e.port
    FROM log_groups g
    LEFT JOIN log_entries e ON e.group_key = g.group_key
    ORDER BY g.created_at, e.sort_order, e.id
  `;
  const r = db().exec(sql);
  if (!r.length) return result;

  for (const row of r[0].values) {
    const gk = row[0] as string;
    const gn = row[1] as string;
    const eid = row[2] as number | null;
    if (!result[gk]) result[gk] = { name: gn, logs: [] };
    if (eid !== null) {
      result[gk].logs.push({
        name: row[3] as string,
        file: row[4] as string,
        port: (row[5] as number) ?? undefined,
      });
    }
  }
  return result;
}

/** Get all log entries as flat list (for log-monitor polling) — single JOIN */
export function getAllLogEntries(): LogEntry[] {
  const sql = `
    SELECT g.group_key, g.name AS group_name, e.name, e.file, e.port
    FROM log_groups g
    JOIN log_entries e ON e.group_key = g.group_key
    ORDER BY g.created_at, e.sort_order, e.id
  `;
  const r = db().exec(sql);
  if (!r.length) return [];
  return r[0].values.map(row => ({
    groupKey: row[0] as string,
    groupName: row[1] as string,
    name: row[2] as string,
    file: row[3] as string,
    port: (row[4] as number) ?? undefined,
  }));
}
