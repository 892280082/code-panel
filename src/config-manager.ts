// ── Config manager — config.json (reviewMode + ttyd) ────────
//   数据库连接 + 日志分组配置已迁移到 SQLite

import fs from 'fs';
import path from 'path';
import type { AppConfig, DbConnection, RawConfig } from './types';
import {
  listConnections, getConnection,
  listConnectionsSafe,
} from './db/db-config-store';
import { getAllGroupsAndLogs } from './log-config-store';

const CFG = path.join(__dirname, '..', 'config.json');

/** 读取原始 config.json（含 ttyd、terminalDefaultCwd 等） */
export function getRawConfig(): RawConfig {
  try {
    return JSON.parse(fs.readFileSync(CFG, 'utf8'));
  } catch {
    return { reviewMode: true };
  }
}

/** 向后兼容别名 */
export function getConfig(): RawConfig {
  return getRawConfig();
}

/** 加载完整配置（groups 从 SQLite 读取，reviewMode 从 config.json 读取） */
export function loadConfig(): AppConfig {
  let reviewMode = true;
  try {
    const raw = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    reviewMode = raw.reviewMode ?? true;
  } catch { /* use default */ }

  return {
    groups: getAllGroupsAndLogs(),
    reviewMode,
  };
}

/** 保存配置（保留 reviewMode + ttyd + terminalDefaultCwd，groups/databases 已在 SQLite） */
export function saveConfig(cfg: AppConfig): void {
  const raw = getRawConfig();
  raw.reviewMode = cfg.reviewMode;
  const tmp = CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, CFG);
}

/** 读取终端默认工作目录 */
export function getTerminalDefaultCwd(): string {
  const raw = getRawConfig();
  return raw.terminalDefaultCwd || '';
}

/** 设置终端默认工作目录 */
export function setTerminalDefaultCwd(cwd: string): void {
  const raw = getRawConfig();
  raw.terminalDefaultCwd = cwd.trim() || undefined;
  const tmp = CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, CFG);
}

/** 原子写入 config.json（仅保留 reviewMode） */
function saveReviewMode(reviewMode: boolean): void {
  const raw = getRawConfig();
  raw.reviewMode = reviewMode;
  const tmp = CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, CFG);
}

// ── DB 连接查询（委托 SQLite store） ──────────────────────

export function getDatabases(): DbConnection[] {
  return listConnections();
}

export function getDatabase(id: string): DbConnection | undefined {
  return getConnection(id);
}

export function getDatabasesSafe(): Array<Omit<DbConnection, 'password'> & { hasPassword: boolean }> {
  return listConnectionsSafe();
}

// ── Review mode ───────────────────────────────────────────

export function getReviewMode(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    return raw.reviewMode ?? true;
  } catch {
    return true;
  }
}

export function setReviewMode(enabled: boolean): AppConfig {
  saveReviewMode(enabled);
  return loadConfig();
}
