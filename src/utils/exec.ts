// ── 通用 execSync 包装(全仓非 git 命令的统一底座)──────────
//   两种语义,各调用方按需选:
//   execCapture — 不抛:非零退出收进 {ok:false, err},适合「探活/尽力而为」(nginx -t、pgrep)
//   execText    — 抛错:非零退出抛 Error(stderr 优先),适合「必须成功」(systemctl、tar、ps)
//   git 命令不走这里 → git/git-exec.ts(领域底座,LC_ALL 等约定独立)。

import { execSync } from 'child_process';

export interface ExecOptions {
  /** 毫秒;默认 10s */
  timeoutMs?: number;
  /** 工作目录 */
  cwd?: string;
  /** 覆盖/附加环境变量 */
  env?: NodeJS.ProcessEnv;
  /** stdout 上限,默认 10MB */
  maxBufferMB?: number;
}

/** execSync 非零退出抛出的异常(stdout/stderr/status 挂在对象上) */
export type ExecError = Error & { stdout?: string; stderr?: string; status?: number };

/** 捕获型:跑命令不抛;stdout/stderr 都收,成败看返回的 ok/err */
export function execCapture(cmd: string, opts: ExecOptions = {}): { ok: boolean; out: string; err: string } {
  try {
    const out = execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 10000,
      maxBuffer: (opts.maxBufferMB ?? 10) * 1024 * 1024,
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: String(out), err: '' };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; message?: string };
    return {
      ok: false,
      out: String(err.stdout ?? ''),
      err: String(err.stderr ?? err.message ?? ''),
    };
  }
}

/** 抛错型:成功返回 stdout;非零退出抛 Error(stderr 优先于 message,带 stdout/status) */
export function execText(cmd: string, opts: ExecOptions = {}): string {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 10000,
    maxBuffer: (opts.maxBufferMB ?? 10) * 1024 * 1024,
    cwd: opts.cwd,
    env: opts.env,
  }) as string;
}
