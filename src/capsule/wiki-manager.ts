// ── Wiki 仓库管理(SSH 公钥 clone / ff-only pull)────────
//   克隆固定在 <capsuleDir>/wiki/(默认 ~/.code-panel-capsules/wiki,
//   随 capsule 目录设置走 —— ⭐ 用户定:胶囊类数据独立于 ~/.code-panel,
//   面板备份会把 ~/.code-panel 整个打包推走,wiki 克隆不得进备份链路)。
//   地址存全局 settings 键 'wiki' = {url, lastPullAt}。只接受
//   git@/ssh://git@ 形式(公钥拉取,不存任何账号密码);面板只 clone/pull
//   不 push —— push 由终端里的 claude code 按 SKILL.md 指令执行。
//   进程内互斥锁防并发 git。

import fs from 'fs';
import path from 'path';
import { gitExec, type GitExecError } from '../git/git-exec';
import { capsuleDir } from './capsule-store';
import { getSetting, setSetting } from '../db/global-store';

export interface WikiConfig {
  url: string;
  lastPullAt?: number;
}

export interface WikiSyncResult {
  status: 'cloned' | 'already' | 'pulled' | 'up-to-date' | 'conflict' | 'error' | 'busy';
  message: string;
}

export function wikiDir(): string {
  return path.join(capsuleDir(), 'wiki');
}

export function getWikiConfig(): WikiConfig {
  return getSetting<WikiConfig>('wiki', { url: '' });
}

export function setWikiUrl(url: string): WikiConfig {
  const c = { ...getWikiConfig(), url: url.trim() };
  setSetting('wiki', c);
  return c;
}

/** 校验:仅接受 SSH 公钥形式(git@…:… / ssh://git@…/…),https 一律拒绝 */
export function isValidWikiUrl(url: string): boolean {
  const u = url.trim();
  return /^(git@|ssh:\/\/git@)[A-Za-z0-9._:-]+[:/][^\s]+$/.test(u);
}

export function isWikiCloned(): boolean {
  return fs.existsSync(path.join(wikiDir(), '.git'));
}

/** 空仓库判定:有 .git 但还没有首个提交(HEAD 未出生)—— rev-parse/log 等
 *  HEAD 命令会报「有歧义的参数 'HEAD'」,需走空仓库分支逻辑 */
export function isWikiEmpty(): boolean {
  if (!isWikiCloned()) return false;
  try {
    gitExec('git rev-parse --verify -q HEAD', { cwd: wikiDir(), timeoutMs: 10000, env: GIT_ENV });
    return false;
  } catch {
    return true;
  }
}

// 只走本机 ssh agent/公钥;首次连接自动接受新主机指纹(accept-new,
// 比 =no 安全);BatchMode 禁交互式输密码(没配公钥直接失败,不挂死)
// (进程 env 由 gitExec 底座带上,这里只声明增量)
const GIT_ENV = {
  GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
};

function runWikiGit(args: string, timeoutMs: number): string {
  return gitExec(`git ${args}`, { timeoutMs, env: GIT_ENV });
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as Error & { stderr?: string | Buffer }).stderr;
    return String(stderr || err.message).trim();
  }
  return String(err).trim();
}

let gitBusy = false;

/** 克隆(目录不存在或半成品无 .git → 清掉重来) */
export function cloneWiki(): WikiSyncResult {
  if (gitBusy) return { status: 'busy', message: '已有 wiki git 操作进行中' };
  const { url } = getWikiConfig();
  if (!url) return { status: 'error', message: '未配置 wiki 仓库地址' };
  if (isWikiCloned()) return { status: 'already', message: '已克隆过' };
  gitBusy = true;
  try {
    // 父目录(capsule 根)可能未建(capsuleDir 默认 ~/.code-panel-capsules,
    // 不随面板初始化创建)→ git clone 只建最后一级,父级先补上
    fs.mkdirSync(path.dirname(wikiDir()), { recursive: true });
    // 半成品(上次 clone 中断留下的目录,无 .git)→ 删掉重来
    if (fs.existsSync(wikiDir())) fs.rmSync(wikiDir(), { recursive: true, force: true });
    runWikiGit(`clone "${url}" "${wikiDir()}"`, 120000);
    return { status: 'cloned', message: '克隆完成' };
  } catch (err: unknown) {
    return { status: 'error', message: errText(err) };
  } finally {
    gitBusy = false;
  }
}

/** 拉取(--ff-only;冲突不动工作区,让用户去终端处理) */
export function pullWiki(): WikiSyncResult {
  if (gitBusy) return { status: 'busy', message: '已有 wiki git 操作进行中' };
  if (!isWikiCloned()) return { status: 'error', message: '尚未克隆(先配地址触发克隆)' };
  // 空仓库(还没首个提交):HEAD 未出生,pull 会报「有歧义的参数 'HEAD'」→ 跳过
  if (isWikiEmpty()) return { status: 'up-to-date', message: '空仓库(还没有首个提交),跳过拉取 —— 归档首个文档后即正常' };
  gitBusy = true;
  try {
    const before = runWikiGit(`-C "${wikiDir()}" rev-parse HEAD`, 15000).trim();
    const out = runWikiGit(`-C "${wikiDir()}" pull --ff-only`, 30000);
    const after = runWikiGit(`-C "${wikiDir()}" rev-parse HEAD`, 15000).trim();
    setSetting('wiki', { ...getWikiConfig(), lastPullAt: Date.now() });
    return before === after
      ? { status: 'up-to-date', message: '已是最新' }
      : { status: 'pulled', message: out.trim() || '已拉取' };
  } catch (err: unknown) {
    const msg = errText(err);
    const conflict = /Not possible to fast-forward|divergent/i.test(msg);
    return { status: conflict ? 'conflict' : 'error', message: msg };
  } finally {
    gitBusy = false;
  }
}

/** 配置页状态卡:克隆状态 + 分支/短 commit/dirty 数/上次同步(空仓库给 empty 标记) */
export function wikiStatus(): Record<string, unknown> {
  const c = getWikiConfig();
  const base: Record<string, unknown> = { url: c.url, clonePath: wikiDir(), cloned: isWikiCloned(), lastPullAt: c.lastPullAt };
  if (!base.cloned) return base;
  if (isWikiEmpty()) return { ...base, empty: true };
  try {
    const branch = runWikiGit(`-C "${wikiDir()}" rev-parse --abbrev-ref HEAD`, 10000).trim();
    const commit = runWikiGit(`-C "${wikiDir()}" log -1 --oneline`, 10000).trim();
    const dirty = runWikiGit(`-C "${wikiDir()}" status --porcelain`, 10000)
      .trim().split('\n').filter(Boolean).length;
    return { ...base, branch, commit, dirty };
  } catch {
    return base; // git 命令异常 → 只给基础字段
  }
}
