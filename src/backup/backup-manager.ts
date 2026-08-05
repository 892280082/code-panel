// ── 定期备份管理:data/backup-config.json 配置 + tar.gz 打包 ──

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const CONFIG_FILE = path.resolve(process.cwd(), 'data/backup-config.json');
export const DEFAULT_BACKUP_DIR = '/Users/owner/upload/code-panel-db-backup';
export const MAX_KEEP = 20;

interface BackupConfig { path: string }

/** 读取配置;首次运行(无配置)写入默认备份路径 */
function getConfig(): BackupConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (c && typeof c.path === 'string' && c.path.trim()) return { path: c.path.trim() };
    }
  } catch { /* ignore */ }
  const cfg = { path: DEFAULT_BACKUP_DIR };
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch { /* ignore */ }
  return cfg;
}

export function getBackupPath(): string {
  return getConfig().path;
}

export function setBackupPath(dir: string): string {
  const cfg = { path: dir.trim() };
  const dirPath = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  return cfg.path;
}

/** 今天的备份文件名:backup-YYYY-MM-DD.tar.gz(本地时区) */
function todayName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.tar.gz`;
}

/** 执行一次备份:打包 data/ + sql-history.json + sql-queue.json,同天同名自动覆盖替换 */
export function runBackup(): { ok: boolean; file?: string; error?: string } {
  const dir = getBackupPath();
  if (!dir) return { ok: false, error: '备份路径未配置' };
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cwd = process.cwd();
    // 收集存在的备份源(data 目录 + 根目录运行时 json)
    const sources: string[] = [];
    if (fs.existsSync(path.join(cwd, 'data'))) sources.push('data');
    for (const f of ['sql-history.json', 'sql-queue.json']) {
      if (fs.existsSync(path.join(cwd, f))) sources.push(f);
    }
    const dest = path.join(dir, todayName());
    execSync(`tar -czf "${dest}" ${sources.map(s => `"${s}"`).join(' ')}`, { cwd, stdio: 'pipe' });
    pruneOldBackups(dir);
    return { ok: true, file: dest };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 列出备份文件(最新在前) */
export function listBackups(): { name: string; size: number; date: string }[] {
  const dir = getBackupPath();
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f))
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return {
        name: f,
        size: st.size,
        date: f.replace(/^backup-(\d{4}-\d{2}-\d{2})\.tar\.gz$/, '$1'),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** 保留最近 MAX_KEEP 个备份,删除更旧的 */
function pruneOldBackups(dir: string): void {
  const files = fs.readdirSync(dir)
    .filter(f => /^backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f))
    .sort();
  while (files.length > MAX_KEEP) {
    fs.unlinkSync(path.join(dir, files.shift()!));
  }
}
