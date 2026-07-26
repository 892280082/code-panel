// ── Database connector — unified interface for MySQL + SQLite ──

import mysql from 'mysql2/promise';
import initSqlJs, { Database as SqlJsDb } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { DbConnection, DbConnectionParams, SqlResult } from '../types';

/** 判断是否为 SELECT 类只读查询 */
export function isReadOnly(sql: string): boolean {
  const s = sql.trim().toUpperCase();
  return s.startsWith('SELECT') || s.startsWith('SHOW') || s.startsWith('DESCRIBE')
      || s.startsWith('EXPLAIN') || s.startsWith('DESC');
}

// ── SQLite 连接缓存 ─────────────────────────────────────

const sqliteDbs: Map<string, SqlJsDb> = new Map();
let sqlJsModule: initSqlJs.SqlJsStatic | null = null;

async function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  if (!sqlJsModule) sqlJsModule = await initSqlJs();
  return sqlJsModule;
}

function openSqlite(dbConfig: DbConnection): SqlJsDb {
  const cached = sqliteDbs.get(dbConfig.id);
  if (cached) return cached;

  if (!sqlJsModule) throw new Error('sql.js not initialized — call getSqlJs() first');

  const filePath = dbConfig.path!;
  let buffer: Uint8Array | undefined;
  if (fs.existsSync(filePath)) {
    buffer = fs.readFileSync(filePath);
  }

  const db = new sqlJsModule.Database(buffer);
  sqliteDbs.set(dbConfig.id, db);
  return db;
}

function saveSqlite(dbConfig: DbConnection): void {
  const db = sqliteDbs.get(dbConfig.id);
  if (!db || !dbConfig.path) return;
  const data = db.export();
  const dir = path.dirname(dbConfig.path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbConfig.path, Buffer.from(data));
}

// ── MySQL 连接池缓存 ─────────────────────────────────────

const mysqlPools: Map<string, mysql.Pool> = new Map();

function getMysqlPool(dbConfig: DbConnection): mysql.Pool {
  let pool = mysqlPools.get(dbConfig.id);
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
    mysqlPools.set(dbConfig.id, pool);
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

// ── 统一查询接口 ─────────────────────────────────────────

export async function executeQuery(dbConfig: DbConnection, sql: string): Promise<SqlResult> {
  const t0 = Date.now();

  if (dbConfig.type === 'sqlite') {
    // 确保 sql.js 已初始化
    await getSqlJs();
    const db = openSqlite(dbConfig);

    if (isReadOnly(sql)) {
      const results: unknown[] = [];
      const stmt = db.prepare(sql);
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return { rows: results as Record<string, unknown>[], executionTime: Date.now() - t0 };
    } else {
      db.run(sql);
      const changes = db.getRowsModified();
      saveSqlite(dbConfig);
      return { changes, affectedRows: changes, executionTime: Date.now() - t0 };
    }
  }

  // MySQL
  const pool = getMysqlPool(dbConfig);
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

export async function testConnection(dbConfig: DbConnection): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  try {
    if (dbConfig.type === 'sqlite') {
      if (!dbConfig.path) return { ok: false, error: 'SQLite path is required' };
      await getSqlJs();
      const db = openSqlite(dbConfig);
      const result = db.exec("SELECT sqlite_version() AS version");
      const ver = result[0]?.values?.[0]?.[0] as string || 'unknown';
      return { ok: true, serverVersion: ver };
    }

    // MySQL
    const pool = getMysqlPool(dbConfig);
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute('SELECT VERSION() AS version');
      const ver = (rows as Array<{ version: string }>)[0]?.version || 'unknown';
      return { ok: true, serverVersion: ver };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
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

/** 关闭指定 ID 的 MySQL 连接池 + SQLite 连接（配置变更后调用） */
export function invalidateConnection(dbId: string): void {
  const pool = mysqlPools.get(dbId);
  if (pool) {
    pool.end();
    mysqlPools.delete(dbId);
  }
  const sqliteDb = sqliteDbs.get(dbId);
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDbs.delete(dbId);
  }
}

// ── 关闭所有连接 ─────────────────────────────────────────

export function closeAll(): void {
  for (const db of sqliteDbs.values()) db.close();
  sqliteDbs.clear();
  for (const pool of mysqlPools.values()) pool.end();
  mysqlPools.clear();
}
