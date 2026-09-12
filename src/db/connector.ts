// ── Database connector — unified interface for MySQL + SQLite ──
//   连接池/SQLite 缓存 key 统一为 `projectId:dbId`,避免不同项目同名 id 串池。
//   配置来自 <项目根>/.code-panel/sql.yaml;内联直连(test/executeQueryDirect)不缓存。

import mysql from 'mysql2/promise';
import initSqlJs, { Database as SqlJsDb, type SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { DbConnection, DbConnectionParams, SqlResult } from '../types';
import { errorMessage } from '../utils/route-utils';

/** 判断是否为 SELECT 类只读查询 */
export function isReadOnly(sql: string): boolean {
  const s = sql.trim().toUpperCase();
  return s.startsWith('SELECT') || s.startsWith('SHOW') || s.startsWith('DESCRIBE')
      || s.startsWith('EXPLAIN') || s.startsWith('DESC');
}

/** 缓存 key:projectId:dbId */
function connKey(projectId: string, dbId: string): string {
  return `${projectId}:${dbId}`;
}

// ── SQLite 连接缓存 ─────────────────────────────────────

const sqliteDbs: Map<string, SqlJsDb> = new Map();
let sqlJsModule: SqlJsStatic | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsModule) sqlJsModule = await initSqlJs();
  return sqlJsModule;
}

function openSqlite(projectId: string, dbConfig: DbConnection): SqlJsDb {
  const key = connKey(projectId, dbConfig.id);
  const cached = sqliteDbs.get(key);
  if (cached) return cached;

  if (!sqlJsModule) throw new Error('sql.js not initialized — call getSqlJs() first');

  const filePath = dbConfig.path!;
  let buffer: Uint8Array | undefined;
  if (fs.existsSync(filePath)) {
    buffer = fs.readFileSync(filePath);
  }

  const db = new sqlJsModule.Database(buffer);
  sqliteDbs.set(key, db);
  return db;
}

function saveSqlite(projectId: string, dbConfig: DbConnection): void {
  const key = connKey(projectId, dbConfig.id);
  const db = sqliteDbs.get(key);
  if (!db || !dbConfig.path) return;
  const data = db.export();
  const dir = path.dirname(dbConfig.path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbConfig.path, Buffer.from(data));
}

// ── MySQL 连接池缓存 ─────────────────────────────────────

const mysqlPools: Map<string, mysql.Pool> = new Map();

function getMysqlPool(projectId: string, dbConfig: DbConnection): mysql.Pool {
  const key = connKey(projectId, dbConfig.id);
  let pool = mysqlPools.get(key);
  if (!pool) {
    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port || 3306,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 3,
      connectTimeout: 10000,
    });
    mysqlPools.set(key, pool);
  }
  return pool;
}

// ── 内联连接参数直连（不查预配置，不缓存） ──────────────

/** 用内联参数创建一次性 MySQL 连接 */
async function createDirectMysqlConnection(params: DbConnectionParams): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: params.host,
    port: params.port || 3306,
    user: params.user,
    password: params.password,
    database: params.database,
    connectTimeout: 10000,
  });
}

// ── 统一查询接口(projectId 用于隔离连接池/SQLite 缓存) ──

export async function executeQuery(projectId: string, dbConfig: DbConnection, sql: string): Promise<SqlResult> {
  const t0 = Date.now();

  if (dbConfig.type === 'sqlite') {
    // 确保 sql.js 已初始化
    await getSqlJs();
    const db = openSqlite(projectId, dbConfig);

    if (isReadOnly(sql)) {
      const results: unknown[] = [];
      const stmt = db.prepare(sql);
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return { rows: results as Record<string, unknown>[], executionTime: Date.now() - t0 };
    } else {
      db.run(sql);
      const changes = db.getRowsModified();
      saveSqlite(projectId, dbConfig);
      return { changes, affectedRows: changes, executionTime: Date.now() - t0 };
    }
  }

  // MySQL
  const pool = getMysqlPool(projectId, dbConfig);
  const conn = await pool.getConnection();
  try {
    const [rows, fields] = await conn.execute(sql);
    if (isReadOnly(sql)) {
      return { rows: (rows as Record<string, unknown>[]), executionTime: Date.now() - t0 };
    } else {
      const result = rows as mysql.ResultSetHeader;
      return {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        changes: result.affectedRows,
        executionTime: Date.now() - t0,
      };
    }
  } finally {
    conn.release();
  }
}

// ── 连接测试 ─────────────────────────────────────────────

/** projectId 可选:给了才会命中项目级缓存(health-check 用),不给则走全局 key */
export async function testConnection(dbConfig: DbConnection, projectId?: string): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  try {
    const pid = projectId ?? '';
    if (dbConfig.type === 'sqlite') {
      if (!dbConfig.path) return { ok: false, error: 'SQLite path is required' };
      await getSqlJs();
      const db = openSqlite(pid, dbConfig);
      const result = db.exec("SELECT sqlite_version() AS version");
      const ver = result[0]?.values?.[0]?.[0] as string || 'unknown';
      return { ok: true, serverVersion: ver };
    }

    // MySQL
    const pool = getMysqlPool(pid, dbConfig);
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute('SELECT VERSION() AS version');
      const ver = (rows as Array<{ version: string }>)[0]?.version || 'unknown';
      return { ok: true, serverVersion: ver };
    } catch (e: unknown) {
      const msg = errorMessage(e);
      return { ok: false, error: msg };
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return { ok: false, error: msg };
  }
}

/** 用内联连接参数执行 SQL（直连，不查预配置） */
export async function executeQueryDirect(params: DbConnectionParams, sql: string): Promise<SqlResult> {
  const t0 = Date.now();

  if (params.type === 'sqlite') {
    if (!params.path) throw new Error('SQLite path is required for direct connection');
    await getSqlJs();
    const filePath = params.path;
    let buffer: Uint8Array | undefined;
    if (fs.existsSync(filePath)) {
      buffer = fs.readFileSync(filePath);
    }
    const SQL = await getSqlJs();
    const db = new SQL.Database(buffer);

    try {
      if (isReadOnly(sql)) {
        const results: unknown[] = [];
        const stmt = db.prepare(sql);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return { rows: results as Record<string, unknown>[], executionTime: Date.now() - t0 };
      } else {
        db.run(sql);
        const changes = db.getRowsModified();
        const data = db.export();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(data));
        return { changes, affectedRows: changes, executionTime: Date.now() - t0 };
      }
    } finally {
      db.close();
    }
  }

  // MySQL — 创建一次性连接，用完即关
  const conn = await createDirectMysqlConnection(params);
  try {
    const [rows] = await conn.execute(sql);
    if (isReadOnly(sql)) {
      return { rows: (rows as Record<string, unknown>[]), executionTime: Date.now() - t0 };
    } else {
      const result = rows as mysql.ResultSetHeader;
      return {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        changes: result.affectedRows,
        executionTime: Date.now() - t0,
      };
    }
  } finally {
    conn.end();
  }
}

/** 关闭指定 (project, dbId) 的 MySQL 连接池 + SQLite 连接(配置变更后调用) */
export function invalidateConnection(projectId: string, dbId: string): void {
  const key = connKey(projectId, dbId);
  const pool = mysqlPools.get(key);
  if (pool) {
    pool.end();
    mysqlPools.delete(key);
  }
  const sqliteDb = sqliteDbs.get(key);
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDbs.delete(key);
  }
}

// ── 关闭所有连接 ─────────────────────────────────────────

export function closeAll(): void {
  for (const db of sqliteDbs.values()) db.close();
  sqliteDbs.clear();
  for (const pool of mysqlPools.values()) pool.end();
  mysqlPools.clear();
}
