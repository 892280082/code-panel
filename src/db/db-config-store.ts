// ── SQLite-backed database connection config store ──────
//   init() 在服务启动时调用一次，之后所有操作同步

import initSqlJs, { Database as SqlJsDb } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { DbConnection } from '../types';
import { setDb, initTables } from '../log-config-store';
import { invalidateConnection } from './connector';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db-config.sqlite');

let db: SqlJsDb | null = null;

// ── Init (startup 时调用一次) ────────────────────────────

export async function init(): Promise<void> {
  const SQL = await initSqlJs();

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS connections (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL,
      version       TEXT DEFAULT '',
      "group"       TEXT DEFAULT '',
      host          TEXT DEFAULT '',
      port          INTEGER DEFAULT 0,
      "user"        TEXT DEFAULT '',
      password      TEXT DEFAULT '',
      database_name TEXT DEFAULT '',
      path          TEXT DEFAULT '',
      notes         TEXT DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `);

  // 升级旧表：添加 group 列（如果不存在）
  try { db.run('ALTER TABLE connections ADD COLUMN "group" TEXT DEFAULT ""'); } catch { /* 已存在 */ }

  // 初始化日志配置表
  setDb(db);
  initTables();

  // 从 config.json 迁移旧数据
  const cfgFile = path.join(__dirname, '..', '..', 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (cfg.databases?.length) {
      const existing = listConnections();
      const ids = new Set(existing.map(e => e.id));
      for (const conn of cfg.databases as DbConnection[]) {
        if (!ids.has(conn.id)) {
          addConnectionInternal(conn);
          console.log(`  migrated: ${conn.id}`);
        }
      }
      // 迁移后从 config.json 移除 databases 字段
      delete cfg.databases;
      fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch { /* config.json may not exist yet */ }

  save();
}

function ensureDb(): SqlJsDb {
  if (!db) throw new Error('db-config-store not initialized — call init() first');
  return db;
}

export function save(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── CRUD (同步) ──────────────────────────────────────────

export function listConnections(): DbConnection[] {
  const d = ensureDb();
  const result = d.exec('SELECT * FROM connections ORDER BY created_at');
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return rowToConnection(obj);
  });
}

export function getConnection(id: string): DbConnection | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM connections WHERE id = ?');
  stmt.bind([id]);
  let result: DbConnection | undefined;
  if (stmt.step()) {
    result = rowToConnection(stmt.getAsObject());
  }
  stmt.free();
  return result;
}

function addConnectionInternal(conn: DbConnection): void {
  const d = ensureDb();
  const now = Date.now();
  d.run(
    `INSERT INTO connections (id, name, type, version, "group", host, port, "user", password, database_name, path, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [conn.id, conn.name, conn.type, conn.version||'', conn.group||'', conn.host||'', conn.port||0,
     conn.user||'', conn.password||'', conn.database||'', conn.path||'', conn.notes||'', now, now],
  );
  save();
}

export function addConnection(conn: DbConnection): void {
  const existing = getConnection(conn.id);
  if (existing) throw new Error(`Database "${conn.id}" already exists`);
  addConnectionInternal(conn);
}

export function updateConnection(id: string, updates: Partial<DbConnection>): DbConnection {
  const existing = getConnection(id);
  if (!existing) throw new Error(`Database "${id}" not found`);
  const merged = { ...existing, ...updates, id };
  const d = ensureDb();
  d.run(
    `UPDATE connections SET name=?, type=?, version=?, "group"=?, host=?, port=?, "user"=?,
     password=?, database_name=?, path=?, notes=?, updated_at=? WHERE id=?`,
    [merged.name, merged.type, merged.version||'', merged.group||'', merged.host||'', merged.port||0,
     merged.user||'', merged.password||'', merged.database||'', merged.path||'',
     merged.notes||'', Date.now(), id],
  );
  save();
  // 配置变更后关闭旧连接池，下次查询自动用新配置重建
  invalidateConnection(id);
  return merged;
}

export function deleteConnection(id: string): void {
  ensureDb().run('DELETE FROM connections WHERE id = ?', [id]);
  save();
  invalidateConnection(id);
}

export function listConnectionsSafe(): Array<Omit<DbConnection, 'password'> & { hasPassword: boolean }> {
  return listConnections().map(conn => {
    const { password, ...rest } = conn as DbConnection & { password?: string };
    return { ...rest, hasPassword: !!password };
  });
}

// ── Helpers ──────────────────────────────────────────────

function rowToConnection(row: Record<string, unknown>): DbConnection {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as DbConnection['type'],
    version: (row.version as string) || '',
    group: (row.group as string) || undefined,
    host: (row.host as string) || undefined,
    port: (row.port as number) || undefined,
    user: (row.user as string) || undefined,
    password: (row.password as string) || undefined,
    database: (row.database_name as string) || undefined,
    path: (row.path as string) || undefined,
    notes: (row.notes as string) || undefined,
  };
}
