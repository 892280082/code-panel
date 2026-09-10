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
  /** superadmin(超管,见全部项目) | user(普通,只见被分配项目) */
  role: string;
  created_at: number;
  updated_at: number;
}

export interface SafeUser {
  id: number;
  username: string;
  role: string;
  created_at: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  root: string;
  note?: string;
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
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      root       TEXT NOT NULL UNIQUE,
      note       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_env (
      project_id TEXT PRIMARY KEY,
      group_id   TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'user',   -- 'user'(手动选用) | 'default'(默认兜底)
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_projects (
      username    TEXT NOT NULL,
      project_id  TEXT NOT NULL,
      PRIMARY KEY (username, project_id)
    );
    CREATE TABLE IF NOT EXISTS llm_providers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      vars       TEXT NOT NULL DEFAULT '',   -- 每行 KEY=VALUE;整段就是一个供应商(含 Key,勿外传)
      enabled    INTEGER NOT NULL DEFAULT 1, -- 0=停用备查(不进右上角切换器)
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 老库迁移:projects 表缺 note 列时补上(中文备注)
  const pcols = db.exec('PRAGMA table_info(projects)');
  const hasNote = pcols.length && pcols[0].values.some((v) => v[1] === 'note');
  if (!hasNote) db.run("ALTER TABLE projects ADD COLUMN note TEXT NOT NULL DEFAULT ''");

  // 老库迁移:users 表缺 role 列(多账号时代)→ 补列,并把存量用户全部升级为超管
  //   (单账号时代的现有用户即面板主人;仅在此迁移瞬间执行一次,幂等)
  const ucols = db.exec('PRAGMA table_info(users)');
  const hasRole = ucols.length && ucols[0].values.some((v) => v[1] === 'role');
  if (!hasRole) {
    db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    db.run("UPDATE users SET role = 'superadmin'");
    console.log('✓ Migrated: 存量用户已升级为超级管理员');
  }

  seedDefaultSettings();
  seedFirstUserFromConfig();
  save();
  // 库里存用户口令哈希与 LLM 供应商 Key,收紧到仅本用户可读
  try { fs.chmodSync(GLOBAL_DB_PATH, 0o600); } catch { /* 首次写入前可能尚无文件 */ }
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

function insertUserRaw(username: string, passwordHash: string, role = 'superadmin'): void {
  const now = Date.now();
  ensureDb().run(
    'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?)',
    [username, passwordHash, role, now, now],
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
  const r = d.exec('SELECT id, username, role, created_at FROM users ORDER BY id');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return {
      id: o.id as number,
      username: o.username as string,
      role: (o.role as string) || 'user',
      created_at: o.created_at as number,
    };
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
      role: (o.role as string) || 'user',
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

/** 加一个账号(明文密码→sha256;role: superadmin | user,默认普通用户) */
export function addUser(username: string, password: string, role = 'user'): void {
  if (findUser(username)) throw new Error(`用户 ${username} 已存在`);
  insertUserRaw(username, sha256(password), role);
}

export function updatePassword(username: string, newPlainPassword: string): void {
  ensureDb().run(
    'UPDATE users SET password_hash=?, updated_at=? WHERE username=?',
    [sha256(newPlainPassword), Date.now(), username],
  );
  save();
}

/** 删除账号(连同其项目分配) */
export function deleteUser(username: string): void {
  ensureDb().run('DELETE FROM users WHERE username = ?', [username]);
  ensureDb().run('DELETE FROM user_projects WHERE username = ?', [username]);
  save();
}

// ── 用户 · 项目分配(user_projects)──────────────────────

/** 用户被分配的项目 id 列表 */
export function listUserProjectIds(username: string): string[] {
  const d = ensureDb();
  const r = d.exec('SELECT project_id FROM user_projects WHERE username = ? ORDER BY project_id', [username]);
  if (!r.length) return [];
  return r[0].values.map(v => v[0] as string);
}

/** 全量重写用户的项目分配 */
export function setUserProjects(username: string, projectIds: string[]): void {
  const d = ensureDb();
  d.run('DELETE FROM user_projects WHERE username = ?', [username]);
  for (const pid of projectIds) {
    d.run('INSERT OR IGNORE INTO user_projects (username, project_id) VALUES (?,?)', [username, pid]);
  }
  save();
}

/** 按用户可见性列项目:超管 → 全部;普通用户 → 仅被分配的 */
export function listProjectsForUser(username: string): ProjectRow[] {
  const user = findUser(username);
  if (!user || user.role === 'superadmin') return listProjects();
  const d = ensureDb();
  const r = d.exec(
    `SELECT p.* FROM projects p
     JOIN user_projects up ON up.project_id = p.id AND up.username = ?
     ORDER BY p.created_at`,
    [username],
  );
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return {
      id: o.id as string,
      name: o.name as string,
      root: o.root as string,
      note: o.note ? (o.note as string) : '',
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  });
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
      note: o.note ? (o.note as string) : '',
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
      note: o.note ? (o.note as string) : '',
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  }
  stmt.free();
  return row;
}

export function addProject(id: string, name: string, root: string, note = ''): ProjectRow {
  const d = ensureDb();
  if (getProject(id)) throw new Error(`项目 ${id} 已存在`);
  const now = Date.now();
  d.run(
    'INSERT INTO projects (id, name, root, note, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [id, name, root, note, now, now],
  );
  save();
  return { id, name, root, note, created_at: now, updated_at: now };
}

export function updateProject(id: string, updates: { name?: string; root?: string; note?: string }): ProjectRow {
  const existing = getProject(id);
  if (!existing) throw new Error(`项目 ${id} 不存在`);
  const merged = {
    ...existing,
    name: updates.name ?? existing.name,
    root: updates.root ?? existing.root,
    note: updates.note ?? existing.note ?? '',
    updated_at: Date.now(),
  };
  ensureDb().run(
    'UPDATE projects SET name=?, root=?, note=?, updated_at=? WHERE id=?',
    [merged.name, merged.root, merged.note, merged.updated_at, id],
  );
  save();
  return merged;
}

export function deleteProject(id: string): void {
  ensureDb().run('DELETE FROM projects WHERE id = ?', [id]);
  ensureDb().run('DELETE FROM user_projects WHERE project_id = ?', [id]); // 清理分配关联
  save();
}

// ── 项目 · 环境组选择(project_env)—— 记录「项目 → 当前环境组」──────

export interface ProjectEnvSelection {
  projectId: string;
  groupId: string;
  /** user = 手动选用;default = 默认组兜底自动记录 */
  source: 'user' | 'default';
  updatedAt: number;
}

export function getProjectEnvSelection(projectId: string): ProjectEnvSelection | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM project_env WHERE project_id = ?');
  stmt.bind([projectId]);
  let row: ProjectEnvSelection | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    row = {
      projectId: o.project_id as string,
      groupId: o.group_id as string,
      source: (o.source as 'user' | 'default') || 'user',
      updatedAt: (o.updated_at as number) || 0,
    };
  }
  stmt.free();
  return row;
}

export function setProjectEnvSelection(
  projectId: string,
  groupId: string,
  source: 'user' | 'default' = 'user',
): void {
  ensureDb().run(
    `INSERT INTO project_env (project_id, group_id, source, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET group_id = excluded.group_id,
       source = excluded.source, updated_at = excluded.updated_at`,
    [projectId, groupId, source, Date.now()],
  );
  save();
}

export function clearProjectEnvSelection(projectId: string): void {
  ensureDb().run('DELETE FROM project_env WHERE project_id = ?', [projectId]);
  save();
}

// ── LLM 供应商(llm_providers)—— 模型供应商切换 ──────────────
//   一套供应商 = 一段环境变量(vars,每行 KEY=VALUE,含 Key)。
//   激活态复用 settings 表('llmActive');settings.json 同步 manifest 也走 settings。

export interface LlmProviderRow {
  id: string;
  name: string;
  vars: string;
  enabled: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface LlmActive {
  providerId: string | null;
  updatedAt: number;
}

function rowToLlmProvider(o: Record<string, unknown>): LlmProviderRow {
  return {
    id: o.id as string,
    name: o.name as string,
    vars: (o.vars as string) ?? '',
    enabled: (o.enabled as number ?? 1) === 1,
    sort_order: (o.sort_order as number) ?? 0,
    created_at: o.created_at as number,
    updated_at: o.updated_at as number,
  };
}

// ── 种子数据:全新安装自动预置 DeepSeek + 智谱 GLM 两条供应商(2026-09-11 用户定)──
//   变量段 9 键同构,token 为 <...> 占位符(用户只需填 Key;激活前防呆会拦未填项)
const LLM_SEED_PROVIDERS: { name: string; vars: string }[] = [
  {
    name: 'DeepSeek',
    vars: [
      'ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的DeepSeek Key>',
      'ANTHROPIC_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash',
      'CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432',
    ].join('\n'),
  },
  {
    name: '智谱 GLM',
    vars: [
      'ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的智谱 Key>',
      'ANTHROPIC_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash',
      'CLAUDE_CODE_SUBAGENT_MODEL=glm-5.3[1m]',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432',
    ].join('\n'),
  },
];

function seedLlmProvidersIfEmpty(d: ReturnType<typeof ensureDb>): void {
  const c = d.exec('SELECT COUNT(*) AS n FROM llm_providers');
  if (c.length && (c[0].values[0][0] as number) > 0) return; // 已有数据 = 非全新,不种子
  for (const s of LLM_SEED_PROVIDERS) addLlmProvider(s);
  save();
}

export function listLlmProviders(): LlmProviderRow[] {
  const d = ensureDb();
  seedLlmProvidersIfEmpty(d); // 全新安装自动预置;已有数据 = 空操作
  const r = d.exec('SELECT * FROM llm_providers ORDER BY sort_order, created_at');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return rowToLlmProvider(o);
  });
}

export function getLlmProvider(id: string): LlmProviderRow | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM llm_providers WHERE id = ?');
  stmt.bind([id]);
  let row: LlmProviderRow | undefined;
  if (stmt.step()) {
    row = rowToLlmProvider(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return row;
}

export function addLlmProvider(input: { id?: string; name: string; vars?: string; enabled?: boolean }): LlmProviderRow {
  const d = ensureDb();
  const id = input.id?.trim() || crypto.randomUUID();
  if (getLlmProvider(id)) throw new Error(`供应商 ${id} 已存在`);
  const now = Date.now();
  const sort = d.exec('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM llm_providers');
  const sortOrder = sort.length ? (sort[0].values[0][0] as number) : 1;
  d.run(
    'INSERT INTO llm_providers (id, name, vars, enabled, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, input.name, input.vars ?? '', input.enabled === false ? 0 : 1, sortOrder, now, now],
  );
  save();
  return { id, name: input.name, vars: input.vars ?? '', enabled: input.enabled !== false, sort_order: sortOrder, created_at: now, updated_at: now };
}

/** 更新(vars 为 undefined = 不动;显式传字符串则整体替换) */
export function updateLlmProvider(id: string, updates: { name?: string; vars?: string; enabled?: boolean }): LlmProviderRow {
  const existing = getLlmProvider(id);
  if (!existing) throw new Error(`供应商 ${id} 不存在`);
  const merged = {
    ...existing,
    name: updates.name ?? existing.name,
    vars: updates.vars ?? existing.vars,
    enabled: updates.enabled ?? existing.enabled,
    updated_at: Date.now(),
  };
  ensureDb().run(
    'UPDATE llm_providers SET name=?, vars=?, enabled=?, updated_at=? WHERE id=?',
    [merged.name, merged.vars, merged.enabled ? 1 : 0, merged.updated_at, id],
  );
  save();
  return merged;
}

export function deleteLlmProvider(id: string): void {
  ensureDb().run('DELETE FROM llm_providers WHERE id = ?', [id]);
  save();
}

export function getLlmActive(): LlmActive | null {
  return getSetting<LlmActive | null>('llmActive', null);
}

export function setLlmActive(providerId: string | null): void {
  setSetting('llmActive', { providerId, updatedAt: Date.now() });
}
