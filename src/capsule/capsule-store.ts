// ── 时空胶囊存储层(目录/扫描/回收站,纯 fs 无状态)──────
//   职责单一:胶囊目录解析、条目扫描、文件读取定位、回收站。
//   监听与 SSE 广播在 capsule-monitor.ts;git wiki 在 wiki-manager.ts。

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSetting, setSetting } from '../db/global-store';
import { safeResolve } from '../utils/safe-resolve';
import { CODE_EXTS } from '../prd/view-pages';

export interface CapsuleEntry {
  id: string;            // 顶层条目名(文件含扩展名 / 目录名)
  kind: 'file' | 'dir';
  mtime: number;         // file=自身;dir=内部最新 mtime
  size: number;          // file=字节数;dir=0
  fileCount: number;     // 可渲染文件数(file=1;dir=md+代码文件计数)
}

const WALK_DEPTH = 4;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** 回收站条目最长保留(过期自动清) */
const TRASH_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

// ── 目录与配置(settings 键 'capsule' = {dir})─────────────
//   默认放 ~/.code-panel-capsules(⭐ 用户定:独立于 ~/.code-panel ——
//   面板备份会把 ~/.code-panel 整个打包推走,胶囊是速记不进备份链路)

export function capsuleDir(): string {
  const c = getSetting<{ dir?: string }>('capsule', {});
  const raw = (c?.dir || '').trim();
  if (!raw) return path.join(os.homedir(), '.code-panel-capsules');
  return raw.startsWith('~/')
    ? path.join(process.env.HOME || '', raw.slice(2))
    : path.resolve(raw);
}

export function setCapsuleDir(dir: string): void {
  setSetting('capsule', { ...getSetting<object>('capsule', {}), dir });
}

// ── 条目扫描(list 路由与监听共用)────────────────────────

function renderable(name: string): boolean {
  return name.endsWith('.md') || CODE_EXTS.includes(path.extname(name).toLowerCase());
}

/** 单条目 stat:file=自身;dir=walk 取最新 mtime + 可渲染文件数 */
export function statCapsuleEntry(p: string, name: string): CapsuleEntry | null {
  let st: fs.Stats;
  try { st = fs.lstatSync(p); } catch { return null; }
  if (st.isSymbolicLink()) return null;
  if (st.isFile()) {
    return { id: name, kind: 'file', mtime: st.mtimeMs, size: st.size, fileCount: 1 };
  }
  if (!st.isDirectory()) return null;
  let maxM = st.mtimeMs;
  let count = 0;
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;
      const ep = path.join(d, e.name);
      try {
        const s2 = fs.statSync(ep);
        if (s2.mtimeMs > maxM) maxM = s2.mtimeMs;
        if (e.isDirectory()) { if (depth < WALK_DEPTH) walk(ep, depth + 1); }
        else if (renderable(e.name)) count++;
      } catch { /* 条目刚好消失 → 跳过 */ }
    }
  };
  walk(p, 0);
  return { id: name, kind: 'dir', mtime: maxM, size: 0, fileCount: count };
}

/** 即时扫描胶囊目录(mtime 倒序);目录不存在 → 空列表 */
export function scanCapsules(): { dir: string; entries: CapsuleEntry[] } {
  const dir = capsuleDir();
  const entries: CapsuleEntry[] = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const e = statCapsuleEntry(path.join(dir, name), name);
      if (e) entries.push(e);
    }
  } catch { /* 目录不存在 → 空 */ }
  entries.sort((a, b) => b.mtime - a.mtime);
  return { dir, entries };
}

// ── 条目解析(读文件/渲染路由用:safeResolve + kind + 渲染基准)──

export interface ResolvedEntry {
  abs: string;          // 条目绝对路径
  kind: 'file' | 'dir';
  renderDir: string;    // 渲染基准目录(file=所在目录;dir=条目自身)
}

export function resolveEntry(id: string): ResolvedEntry {
  const abs = safeResolve(capsuleDir(), id);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch {
    throw new Error(`胶囊不存在: ${id}`);
  }
  if (st.isFile()) return { abs, kind: 'file', renderDir: path.dirname(abs) };
  if (st.isDirectory()) return { abs, kind: 'dir', renderDir: abs };
  throw new Error(`非胶囊条目: ${id}`);
}

// ── 回收站(删除=挪进来,7 天内可恢复;点开头天然不被监听/列表)──

function trashDir(): string {
  return path.join(capsuleDir(), '.trash');
}

/** 删除条目 → 回收站(带时间戳前缀,同名可反复删) */
export function moveToTrash(abs: string, name: string): string {
  fs.mkdirSync(trashDir(), { recursive: true });
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const tag = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  const trashName = `${tag}-${name}`;
  fs.renameSync(abs, path.join(trashDir(), trashName));
  return trashName;
}

/** 回收站列表(mtime 倒序) */
export function listTrash(): { name: string; mtime: number; kind: 'file' | 'dir' }[] {
  const items: { name: string; mtime: number; kind: 'file' | 'dir' }[] = [];
  try {
    for (const name of fs.readdirSync(trashDir())) {
      if (name.startsWith('.')) continue;
      try {
        const st = fs.statSync(path.join(trashDir(), name));
        items.push({ name, mtime: st.mtimeMs, kind: st.isDirectory() ? 'dir' : 'file' });
      } catch { /* 消失即跳过 */ }
    }
  } catch { /* 回收站不存在 → 空 */ }
  return items.sort((a, b) => b.mtime - a.mtime);
}

/** 清空全部胶囊(逐条挪回收站,返回清掉的数量) */
export function clearCapsules(): number {
  const dir = capsuleDir();
  let n = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      try {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (!st.isFile() && !st.isDirectory()) continue;
        moveToTrash(p, name);
        n++;
      } catch { /* 单条失败跳过 */ }
    }
  } catch { /* 目录不存在 → 0 */ }
  return n;
}

/** 从回收站恢复:去掉时间戳前缀还原原名;原位被占 → 加 -restored 后缀 */
export function restoreFromTrash(trashName: string): string {
  const src = safeResolve(trashDir(), trashName);
  if (!fs.existsSync(src)) throw new Error(`回收站里没有: ${trashName}`);
  const orig = trashName.replace(/^\d{8}-\d{6}-/, '') || trashName;
  let dest = path.join(capsuleDir(), orig);
  if (fs.existsSync(dest)) {
    dest = path.join(capsuleDir(), `${orig.replace(/\/$/, '')}-restored-${Date.now() % 10000}`);
  }
  fs.renameSync(src, dest);
  return path.basename(dest);
}

/** 清理回收站里超过保留期的条目(监听节流调用 + 启动时一次) */
export function cleanTrash(): void {
  try {
    for (const name of fs.readdirSync(trashDir())) {
      const p = path.join(trashDir(), name);
      try {
        const st = fs.statSync(p);
        if (Date.now() - st.mtimeMs > TRASH_MAX_AGE_MS) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      } catch { /* 单条失败跳过 */ }
    }
  } catch { /* 回收站不存在 → 无事 */ }
}
