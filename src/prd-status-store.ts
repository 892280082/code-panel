// ── PRD 文档完成状态 SQLite 存储 ────────────────────────
// 表 prd_status(path TEXT PK, done INTEGER, updated_at INTEGER)
// 与 db-config.sqlite 同库（由 db-config-store.init 共享）

import type { Database } from 'sql.js';
import { save as saveDb } from './db/db-config-store';

let _db: Database | null = null;

export function setDb(db: Database): void {
  _db = db;
}

function db(): Database {
  if (!_db) throw new Error('prd-status-store: db not open — ensure db-config-store.init() ran first');
  return _db;
}

export function initTables(): void {
  const d = db();
  d.run(`
    CREATE TABLE IF NOT EXISTS prd_status (
      path       TEXT PRIMARY KEY,
      done       INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);
}

/** 查询某文档是否已在库中标记完成 */
export function isDoneInDb(path: string): boolean {
  try {
    const res = db().exec('SELECT done FROM prd_status WHERE path=?', [path]);
    if (res.length && res[0].values.length) return res[0].values[0][0] === 1;
    return false;
  } catch { return false; }
}

/** 写入/更新完成状态到数据库 */
export function setDoneInDb(path: string, done: boolean): void {
  try {
    const d = db();
    d.run(
      'INSERT INTO prd_status(path, done, updated_at) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET done=?, updated_at=?',
      [path, done ? 1 : 0, Date.now(), done ? 1 : 0, Date.now()],
    );
    saveDb();
  } catch { /* ignore */ }
}
