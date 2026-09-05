// ── 全局库 ~/.code-panel/data.db(sql.js) ────────────────
//   只存三类:users(账号) / projects(项目注册表) / settings(面板级公共配置)。
//   所有「具体项目信息」不在此库 —— 一律在 <项目根>/.code-panel/*.yaml + data/。

import initSqlJs, { Database as SqlJsDb } from 'sql.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GLOBAL_DB_PATH, globalDataDir } from '../paths';

// ── 类型 ────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
}

export interface SafeUser {
  id: number;
  username: string;
  created_at: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  root: string;
  created_at: number;
  updated_at: number;
}

let db: SqlJsDb | null = null;

function ensureDb(): SqlJsDb {
  if (!db) throw new Error('global-store not initialized — call initGlobalStore() first');
  return db;
}

function save(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(GLOBAL_DB_PATH, Buffer.from(data));
}

/** sha256 hex(与 fork/config.json credentials 兼容) */
export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ── Init ────────────────────────────────────────────────

export async function initGlobalStore(): Promise<void> {
  const SQL = await initSqlJs();
  const dir = globalDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = fs.existsSync(GLOBAL_DB_PATH)
    ? new SQL.Database(fs.readFileSync(GLOBAL_DB_PATH))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      root       TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  seedDefaultSettings();
  seedFirstUserFromConfig();
  save();
  console.log(`✓ Global store → ${GLOBAL_DB_PATH}`);
}

/** 首次运行写入默认面板设置(reviewMode 从旧 config.json 继承一次) */
function seedDefaultSettings(): void {
  if (hasSetting('reviewMode')) return;
  let reviewMode = true;
  try {
    const cfgFile = path.join(__dirname, '..', '..', 'config.json');
    const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (typeof raw.reviewMode === 'boolean') reviewMode = raw.reviewMode;
  } catch { /* config.json 不存在则默认 true */ }
  setSetting('reviewMode', reviewMode);
}

/** users 为空时,从 config.json credentials 播种首个账号(与 fork 的 sha256 哈希兼容) */
function seedFirstUserFromConfig(): void {
  try {
    if (countUsers() > 0) return;
    const cfgFile = path.join(__dirname, '..', '..', 'config.json');
    const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    const c = raw.credentials;
    if (c && typeof c.username === 'string' && typeof c.passwordHash === 'string' && c.username.trim()) {
      insertUserRaw(c.username.trim(), c.passwordHash);
      console.log(`✓ Seeded initial user: ${c.username.trim()}`);
      return;
    }
  } catch { /* ignore */ }
  console.warn('[auth] users 表为空且 config.json 无 credentials。请在 config.json 配置 {credentials:{username,passwordHash(sha256)}} 后重启以播种首个账号。');
}

// ── Settings ────────────────────────────────────────────

export function hasSetting(key: string): boolean {
  const d = ensureDb();
  const stmt = d.prepare('SELECT 1 FROM settings WHERE key = ?');
  stmt.bind([key]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

export function getSetting<T>(key: string, fallback: T): T {
  const d = ensureDb();
  const stmt = d.prepare('SELECT value FROM settings WHERE key = ?');
  stmt.bind([key]);
  let value = fallback;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    try { value = JSON.parse(row.value as string) as T; } catch { value = fallback; }
  }
  stmt.free();
  return value;
}

export function setSetting(key: string, value: unknown): void {
  ensureDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
  save();
}

// ── Users ───────────────────────────────────────────────

function insertUserRaw(username: string, passwordHash: string): void {
  const now = Date.now();
  ensureDb().run(
    'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?,?,?,?)',
    [username, passwordHash, now, now],
  );
  save();
}

export function countUsers(): number {
  const d = ensureDb();
  const r = d.exec('SELECT COUNT(*) AS n FROM users');
  return r.length ? (r[0].values[0][0] as number) : 0;
}

export function listUsersSafe(): SafeUser[] {
  const d = ensureDb();
  const r = d.exec('SELECT id, username, created_at FROM users ORDER BY id');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return { id: o.id as number, username: o.username as string, created_at: o.created_at as number };
  });
}

export function findUser(username: string): UserRow | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM users WHERE username = ?');
  stmt.bind([username]);
  let row: UserRow | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    row = {
      id: o.id as number,
      username: o.username as string,
      password_hash: o.password_hash as string,
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  }
  stmt.free();
  return row;
}

export function verifyUser(username: string, password: string): boolean {
  const user = findUser(username);
  if (!user) return false;
  return sha256(password) === user.password_hash;
}

/** 加一个账号(明文密码→sha256) */
export function addUser(username: string, password: string): void {
  if (findUser(username)) throw new Error(`用户 ${username} 已存在`);
  insertUserRaw(username, sha256(password));
}

export function updatePassword(username: string, newPlainPassword: string): void {
  ensureDb().run(
    'UPDATE users SET password_hash=?, updated_at=? WHERE username=?',
    [sha256(newPlainPassword), Date.now(), username],
  );
  save();
}

// ── Projects 注册表 ─────────────────────────────────────

export function listProjects(): ProjectRow[] {
  const d = ensureDb();
  const r = d.exec('SELECT * FROM projects ORDER BY created_at');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return {
      id: o.id as string,
      name: o.name as string,
      root: o.root as string,
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  });
}

export function getProject(id: string): ProjectRow | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM projects WHERE id = ?');
  stmt.bind([id]);
  let row: ProjectRow | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    row = {
      id: o.id as string,
      name: o.name as string,
      root: o.root as string,
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  }
  stmt.free();
  return row;
}

export function addProject(id: string, name: string, root: string): ProjectRow {
  const d = ensureDb();
  if (getProject(id)) throw new Error(`项目 ${id} 已存在`);
  const now = Date.now();
  d.run(
    'INSERT INTO projects (id, name, root, created_at, updated_at) VALUES (?,?,?,?,?)',
    [id, name, root, now, now],
  );
  save();
  return { id, name, root, created_at: now, updated_at: now };
}

export function updateProject(id: string, updates: { name?: string; root?: string }): ProjectRow {
  const existing = getProject(id);
  if (!existing) throw new Error(`项目 ${id} 不存在`);
  const merged = {
    ...existing,
    name: updates.name ?? existing.name,
    root: updates.root ?? existing.root,
    updated_at: Date.now(),
  };
  ensureDb().run(
    'UPDATE projects SET name=?, root=?, updated_at=? WHERE id=?',
    [merged.name, merged.root, merged.updated_at, id],
  );
  save();
  return merged;
}

export function deleteProject(id: string): void {
  ensureDb().run('DELETE FROM projects WHERE id = ?', [id]);
  save();
}
