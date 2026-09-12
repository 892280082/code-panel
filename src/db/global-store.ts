// ── 全局库 ~/.code-panel/data.db(sql.js) ────────────────
//   只存五类:users(账号) / projects(项目注册表) / settings(面板级公共配置)
//   / project_env(项目→环境组) / llm_providers(模型供应商)。
//   所有「具体项目信息」不在此库 —— 一律在 <项目根>/.code-panel/*.yaml + data/。
//
//   本文件 = 初始化(建表/迁移/种子)+ 全量转发出口;
//   各域 CRUD 在同目录四域文件里(core/settings/users/projects/llm),
//   31 个消费者的 `from '../db/global-store'` 导入路径不变。

// 转发出口(类型一并 re-export;五域无同名导出)
export * from './core';
export * from './settings';
export * from './users';
export * from './projects';
export * from './llm';

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { GLOBAL_DB_PATH, globalDataDir } from '../paths';
import { setDb, save } from './core';
import { hasSetting, setSetting } from './settings';
import { countUsers, insertUserRaw } from './users';

// ── Init ────────────────────────────────────────────────

export async function initGlobalStore(): Promise<void> {
  const SQL = await initSqlJs();
  const dir = globalDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = fs.existsSync(GLOBAL_DB_PATH)
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

  setDb(db);
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
