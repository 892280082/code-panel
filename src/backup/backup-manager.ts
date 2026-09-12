// ── 定期备份管理 ─────────────────────────────────────────
//   备份内容(严格两层模型):
//     ① 全局层 ~/.code-panel/(data.db + jwt.secret + 其它)
//     ② 每个已注册项目的 .code-panel/(yaml 配置 + data/ 运行数据)
//   打包为 backup-YYYY-MM-DD.tar.gz(同天同名覆盖),保留最近 MAX_KEEP 份。
//   备份路径存全局 settings.backup.path(不再读 data/backup-config.json)。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { globalDataDir } from '../paths';
import { getSetting, setSetting } from '../db/global-store';
import { allProjects } from '../projects/project-store';
import { errorMessage } from '../utils/route-utils';

export const MAX_KEEP = 20;
const DEFAULT_BACKUP_DIR = '/Users/owner/upload/code-panel-db-backup';

function backupConfig(): { path: string } {
  const c = getSetting<{ path?: string }>('backup', { path: DEFAULT_BACKUP_DIR });
  const dir = c?.path?.trim();
  return { path: dir || DEFAULT_BACKUP_DIR };
}

export function getBackupPath(): string {
  return backupConfig().path;
}

export function setBackupPath(dir: string): string {
  const p = dir.trim();
  setSetting('backup', { path: p });
  return p;
}

/** 今天的备份文件名:backup-YYYY-MM-DD.tar.gz(本地时区) */
function todayName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.tar.gz`;
}

/** 递归拷贝(含隐藏文件),目标自动创建 */
function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

/** 执行一次备份;返回 dest 文件(供调用方展示) */
export function runBackup(): { ok: boolean; file?: string; error?: string } {
  const dir = getBackupPath();
  if (!dir) return { ok: false, error: '备份路径未配置' };
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 暂存目录,规整目录名后统一 tar,保证恢复结构清晰
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'code-panel-bak-'));
    copyDir(globalDataDir(), path.join(stage, 'global.code-panel'));
    for (const p of allProjects()) {
      copyDir(path.join(p.root, '.code-panel'), path.join(stage, `${p.id}.code-panel`));
    }

    const dest = path.join(dir, todayName());
    execSync(`tar -czf "${dest}" -C "${stage}" .`, { stdio: 'pipe' });
    fs.rmSync(stage, { recursive: true, force: true });

    pruneOldBackups(dir);
    return { ok: true, file: dest };
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e) };
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
