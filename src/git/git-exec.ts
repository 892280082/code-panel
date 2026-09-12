// ── git execSync 底座(git-diff / git-pull / wiki-manager 三份包装的公共形态)──
//   差异只在「出错策略 / env / 超时」,由各文件的薄封装表达;
//   底座统一 encoding / maxBuffer / LC_ALL,并把非零退出的原始异常透传出去。

import { execSync } from 'child_process';

export interface GitExecOptions {
  /** 毫秒;默认 30s(git-diff 用 15s,wiki clone/pull 传更长) */
  timeoutMs?: number;
  /** 工作目录;缺省 = 当前进程 cwd(wiki 传克隆目录) */
  cwd?: string;
  /** 附加环境变量(wiki 的 GIT_SSH_COMMAND 等);覆盖同名默认 */
  env?: NodeJS.ProcessEnv;
}

/** execSync 非零退出抛出的异常(stdout/stderr/status 挂在对象上) */
export type GitExecError = Error & { stdout?: string; stderr?: string; status?: number };

/** 执行 git 命令。不吞错误:非零退出原样抛 GitExecError,策略由调用方决定
 *  (diff 版取 stdout 当结果、pull 版抛 stderr、wiki 版靠 errText 提取)。 */
export function gitExec(cmdline: string, opts: GitExecOptions = {}): string {
  return execSync(cmdline, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: opts.timeoutMs ?? 30000,
    cwd: opts.cwd,
    env: { ...process.env, LC_ALL: 'C.UTF-8', ...opts.env },
  });
}
