// ── TTYD Process Manager (v2 — multi-session) ──────────────
//   端口 9001: FAB 浮动终端（持久 session）
//   端口 9002-9011: 命令终端（动态分配，页面级生命周期）

import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import { getConfig, getTerminalDefaultCwd } from '../config-manager';
import { readActiveEnvVars } from '../env/env-store';
import { readLlmProviderEnv } from '../llm/provider-store';

interface TTYDState {
  process: ChildProcess | null;
  port: number;
  retryCount: number;
  status: 'running' | 'restarting' | 'stopped';
}

export interface SessionInfo {
  port: number;
  label: string;
  command: string;
  cwd: string;
  createdAt: number;
}

// ── FAB 终端（端口 9001，持久 session）─────────────────────

const fabState: TTYDState = {
  process: null,
  port: 9001,
  retryCount: 0,
  status: 'stopped',
};

const MAX_RETRIES = 3;

// ── 会话 run-once 标记(全终端通用:keepShell 两种模式都注册)──
//   见 spawnTTYD 里 2026-09-19 事故说明:标记文件 = 「这个窗口的命令已经跑过了」。
//   ttyd 按 WS 连接 fork 命令,所以客户端自动重连 / 用户重开窗口都会再 fork 一次:
//   一次性窗口重连只打印提示(不重跑),交互窗口重连只给一个干净 shell(不重跑命令)。
const ONESHOT_MARK_DIR = '/tmp/code-panel-oneshot';
const sessionMarks = new Map<number, string>();   // port → 标记文件路径

function sessionMarkPath(runId: string): string {
  return `${ONESHOT_MARK_DIR}/${runId}.ran`;
}

export function getTTYDStatus(): { status: string; port: number; retryCount: number } {
  return {
    status: fabState.status,
    port: fabState.port,
    retryCount: fabState.retryCount,
  };
}

function spawnTTYD(port: number, opts?: { cmd?: string; cwd?: string; keepShell?: boolean; runId?: string }): ChildProcess {
  const config = getConfig();
  const shell = config.ttyd?.command ?? 'bash';
  const extraArgs = config.ttyd?.args ? config.ttyd.args.split(/\s+/) : ['-W'];

  let spawnArgs: string[];
  if (opts?.cmd || opts?.cwd) {
    const cdPart = opts.cwd ? `cd ${opts.cwd} && ` : '';
    const cmd = opts.cmd || `exec ${shell}`;
    // keepShell=true(默认,交互终端):执行完命令再起交互 shell,窗口常驻。
    //   同样加 run-once 锁 —— 重连只给一个干净 shell,**绝不再跑命令**;
    //   且**不加** `-t disableReconnect=true`:交互终端必须保留客户端自动重连,
    //   否则网络抖一下就变砖。cd 在重连分支也要带上,否则重连后 shell 的 cwd 跑偏。
    // keepShell=false(一次性,Apps 启停用):★ 2026-09-19 事故根因 ——
    //   ① ttyd 是「每来一个 WS 连接就 fork 一次命令」:实测同一 ttyd 连两次 WS,
    //      命令真的执行 2 次(2 个 pid、2 行输出);
    //   ② 命令毫秒~1s 跑完 → ttyd 关 WS → ttyd 自带客户端写死 reconnect=!0 →
    //      100~300ms 后自动重连 → 命令重跑 + 终端 reset(用户看到的「窗口反复刷新」)
    //      → 自持循环,越刷越多;
    //   ③ 现场证据:9002 的 journal 14:50:00→14:50:04 有 11 次 `started process, pid:...`,
    //      .logs/zc-main.log 里正好 11 行 `--- zc-main (7071) ---`(start.sh 跑了 11 遍)
    //      → 20 个 Gradle Daemon → BUILD FAILED。
    //   对策:`-t disableReconnect=true` 关掉客户端自动重连(消灭「刷新」);再套一层
    //   run-once 包装做兜底 —— 就算还有人连上来,命令也只跑第一次。
    //   ttyd 命令退出后自己不退,端口回收仍由 watchOneshotExit 负责。
    const keepShell = opts?.keepShell !== false;
    const mark = sessionMarkPath(opts?.runId ?? `port-${port}`);
    if (keepShell) {
      // 重连分支只 exec shell → 命令不重跑,但窗口依然可用(可继续交互)。
      // ⚠ 重连分支的 cd 必须「失败也算数」:交互窗口开着客户端自动重连,若 cd 用
      // `&&` 短路掉 exec,cwd 失效(项目被搬走/路径含空格)时每次连接都拿不到 shell
      // → 秒退 → 自动重连 → 秒退 = 永久重连风暴(本次要消灭的症状换个入口复活,
      // 且交互窗口没有 watchOneshotExit 兜底,端口永不回收)。
      const cdSafe = opts.cwd ? `cd "${opts.cwd}" 2>/dev/null; ` : '';
      const keepScript = [
        `mkdir -p "${ONESHOT_MARK_DIR}"`,
        `if [ -e "${mark}" ]; then`,
        `  ${cdSafe}exec ${shell}`,
        `else`,
        `  : > "${mark}"`,
        `  ${cdPart}${cmd}; exec ${shell}`,
        `fi`,
      ].join('\n');
      spawnArgs = ['-p', String(port), ...extraArgs, shell, '-c', keepScript];
    } else {
      const onceScript = [
        `mkdir -p "${ONESHOT_MARK_DIR}" || { echo "[code-panel] 无法创建 run-once 标记目录,拒绝执行(防重复)"; exit 1; }`,
        `if [ -e "${mark}" ]; then`,
        `  echo "[code-panel] 本窗口的一次性命令已执行过 —— 重复连接不会重跑(要重跑请关闭窗口后重新点击)"`,
        `else`,
        `  : > "${mark}" || { echo "[code-panel] run-once 标记写不进去,拒绝执行(防重复)"; exit 1; }`,
        `  ${cdPart}${cmd}`,
        `fi`,
      ].join('\n');
      spawnArgs = ['-p', String(port), ...extraArgs, '-t', 'disableReconnect=true', shell, '-c', onceScript];
    }
  } else {
    spawnArgs = ['-p', String(port), ...extraArgs, shell];
  }

  console.log(`[TTYD] starting on port ${port}: ttyd ${spawnArgs.join(' ')}`);

  // 注入全局 active-env(code-panel 终端是 bash,不 source ~/.zshrc,须显式带上环境组变量)
  // + LLM 供应商变量(在后,覆盖环境组同名)
  const extraEnv = { ...readActiveEnvVars(), ...readLlmProviderEnv() };
  const proc = spawn('ttyd', spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, ...extraEnv },
  });

  proc.stderr?.on('data', (data: Buffer) => {
    console.error(`[TTYD:${port}] ${data.toString().trim()}`);
  });

  proc.on('error', (err: Error) => {
    console.error(`[TTYD:${port}] spawn error: ${err.message}`);
  });

  return proc;
}

function spawnFABTTYD(): ChildProcess {
  const proc = spawnTTYD(fabState.port);
  let started = false;
  // 稳定运行计时器:跑满 30s 才清零重试计数(见下方 exit 处理里的说明)
  let stableTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    stableTimer = null;
    fabState.retryCount = 0;
  }, 30_000);

  proc.on('exit', (code: number | null, signal: string | null) => {
    console.log(`[TTYD:FAB] exited (code=${code}, signal=${signal})`);
    fabState.process = null;
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }   // 没跑满稳定期,计数保留

    if (fabState.status === 'stopped') return;

    if (fabState.retryCount < MAX_RETRIES) {
      fabState.retryCount++;
      fabState.status = 'restarting';
      console.log(`[TTYD:FAB] restarting (attempt ${fabState.retryCount}/${MAX_RETRIES})...`);
      setTimeout(() => {
        fabState.process = spawnFABTTYD();
        fabState.status = 'running';
      }, 1000);
    } else {
      fabState.status = 'stopped';
      console.error(`[TTYD:FAB] failed after ${MAX_RETRIES} restart attempts`);
    }
  });

  // 基本启动后标记为 running（自动重启有 1s 延迟，足够就绪）
  setTimeout(() => { started = true; fabState.status = 'running'; }, 300);
  return proc;
}

export async function startFABTTYD(): Promise<void> {
  if (fabState.process) return;
  fabState.process = spawnFABTTYD();
  const ready = await waitForPort(fabState.port, 3000);
  if (ready) {
    fabState.status = 'running';
  } else {
    console.error(`[TTYD:FAB] failed to start on port ${fabState.port}`);
  }
}

export function stopFABTTYD(): void {
  fabState.status = 'stopped';
  if (fabState.process) {
    fabState.process.kill('SIGTERM');
    fabState.process = null;
  }
}

// ── 命令终端（动态端口池 9002-9011）───────────────────────

const PORT_POOL_START = 9002;
const PORT_POOL_END = 9011;
const PORT_POOL_SIZE = PORT_POOL_END - PORT_POOL_START + 1;
const usedPorts = new Set<number>();
const sessionMap = new Map<number, { process: ChildProcess; info: SessionInfo }>();

function allocatePort(): number | null {
  for (let p = PORT_POOL_START; p <= PORT_POOL_END; p++) {
    if (!usedPorts.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  return null;
}

function releasePort(port: number, proc?: ChildProcess): void {
  // ★ 归属校验:端口池会复用端口号(killSession 同步释放端口后旧 proc 的 exit 才到),
  // 旧会话的 exit 回调绝不能抹掉复用同端口的新会话 —— 否则新会话的 run-once 标记被
  // 静默删除 → 「只跑一次」失效;新会话还会从会话表消失。传了 proc 就只认自己的。
  if (proc && sessionMap.get(port)?.process !== proc) return;
  usedPorts.delete(port);
  sessionMap.delete(port);
  // 会话 run-once 标记随之清理(keepShell 两种模式一视同仁,否则 /tmp/code-panel-oneshot
  // 越积越多);已删过/从未建过都静默忽略。
  const mark = sessionMarks.get(port);
  if (mark) {
    sessionMarks.delete(port);
    try { fs.unlinkSync(mark); } catch { /* already gone */ }
  }
}

/** ★ 一次性会话回收:命令退出后杀掉 ttyd。
 *  ttyd 1.7.x 在子进程(命令)退出后自己不退 —— 实测(2026-09-19):keepShell=false
 *  的命令毫秒级跑完后,ttyd 进程/端口/会话永久残留,前端 watchAutoClose 永远
 *  等不到回收 → 死终端窗口反复重连闪烁 + 端口池泄漏(池仅 10 个,占满后命令
 *  终端全军覆没)。
 *  ★ 竞态修复(2026-09-19):ttyd 是「客户端 WS 连上才 fork 命令」(见 spawnTTYD),
 *  所以客户端还没连上时 ttyd 本来就没有子进程 —— 旧逻辑此时连续 2 轮 pgrep 落空,
 *  ~1.6s 就把 ttyd 杀了,**命令根本没跑**。现在改用 run-once 标记文件当「命令已启动」
 *  的信号:标记不存在 = 还没有人连上 = 不计数(直接 return);只有超过 25s 仍无人连
 *  才 SIGTERM 兜底防端口泄漏。
 *  标记存在后维持原逻辑:400ms 轮询 `pgrep -P`,连续 2 轮无子进程 = 命令已退出;
 *  宽限 0.8s(让客户端收完尾部输出)再 SIGTERM → proc exit → releasePort 走既有回收链。 */
function watchOneshotExit(proc: ChildProcess, mark: string): void {
  const pid = proc.pid;
  if (!pid) return;
  const HARD_LIMIT_MS = 25_000;
  const startedAt = Date.now();
  let deadStreak = 0;
  let settled = false;
  const killProc = () => {
    settled = true;
    try { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM'); } catch { /* already dead */ }
  };
  const timer = setInterval(() => {
    if (settled || proc.exitCode !== null || proc.signalCode !== null) {
      clearInterval(timer);
      return;
    }
    if (!fs.existsSync(mark)) {
      // 命令还没被 fork(客户端未连接)→ 不算 dead 轮次;仅硬上限兜底
      if (Date.now() - startedAt >= HARD_LIMIT_MS) {
        clearInterval(timer);
        console.log(`[TTYD:${pid}] oneshot 命令 ${HARD_LIMIT_MS / 1000}s 内无人连接,回收 ttyd`);
        killProc();
      }
      return;
    }
    try {
      const out = execSync(`pgrep -P ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
      deadStreak = out ? 0 : deadStreak + 1;
    } catch { deadStreak += 1; }   // pgrep 无匹配退出码非 0 = 子进程已没了
    if (deadStreak >= 2) {
      clearInterval(timer);
      setTimeout(() => { if (!settled && proc.exitCode === null && proc.signalCode === null) killProc(); }, 800);
    }
  }, 400);
  proc.on('exit', () => { clearInterval(timer); });
}

/** 等待 ttyd 端口就绪（最多 3 秒） */
function waitForPort(port: number, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  return new Promise(resolve => {
    function tryConnect() {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); });
      sock.on('timeout', () => { sock.destroy(); });
      sock.connect(port, '127.0.0.1');
      sock.on('close', () => {
        if (Date.now() - start < timeoutMs) {
          setTimeout(tryConnect, 100);
        } else {
          resolve(false);
        }
      });
    }
    tryConnect();
  });
}

/** 端口是否有人在监听（纯 Node 探活：连得上 = 有监听者；不依赖 lsof） */
function isPortListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(300);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

/** 杀掉端口上的监听进程。池内端口只可能是上个面板进程遗留的孤儿 ttyd，
 *  但拿不到 pid（lsof 不可用）时静默返回 —— 调用方会走「换下一个端口」兜底。 */
function killPortListeners(port: number): void {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' }).trim();
    for (const line of out.split('\n')) {
      const pid = parseInt(line.trim(), 10);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`[TTYD] 清走 ${port} 上的残留进程 (pid=${pid})`);
        } catch { /* already dead */ }
      }
    }
  } catch { /* 端口空闲 / lsof 不可用 */ }
}

/** ★ 拿一个「确认空闲」的端口再起 ttyd —— 绝不能往被占的端口上硬起。
 *  ttyd 撞端口会 bind 失败秒退，而 waitForPort 连上的是占位者、照样判「就绪」，
 *  于是会话被判成功、iframe 接上残留进程的空 shell，用户看到的是「点了没反应」
 *  （2026-09-18 事故：9/15 遗留的孤儿 ttyd 占住 9002，命令终端全军覆没）。 */
async function acquireFreePort(): Promise<number | null> {
  for (let i = 0; i < PORT_POOL_SIZE; i++) {
    const p = allocatePort();
    if (p === null) return null;                 // 池已满（在用的窗口太多）
    if (await ensurePortFree(p)) return p;
    releasePort(p);                              // 占着且清不掉 → 换下一个池位
  }
  return null;
}

/** 端口空闲？被残留 ttyd 占着就先请走，等它真正释放（最多 1.5s） */
async function ensurePortFree(port: number): Promise<boolean> {
  if (!(await isPortListening(port))) return true;   // 常态：池位空闲
  killPortListeners(port);
  const start = Date.now();
  while (Date.now() - start < 1500) {
    await new Promise(r => setTimeout(r, 100));
    if (!(await isPortListening(port))) return true;
  }
  return false;
}

/** 启动清理：杀上个面板进程残留的命令终端 ttyd（9002-9011）。
 *  systemd 单元 ExecStartPre 只清 3008/9001，池子里的孤儿会一直占位，
 *  必须由进程自己扫一遍（与 tmux 的 cleanupStaleTmuxAttachPorts 对称）。 */
export function cleanupStaleCmdPorts(): number {
  let n = 0;
  for (let p = PORT_POOL_START; p <= PORT_POOL_END; p++) {
    if (usedPorts.has(p)) continue;
    try {
      const out = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' }).trim();
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (pid && pid !== process.pid) {
          try {
            process.kill(pid, 'SIGTERM');
            n++;
            console.log(`[TTYD] cleanup stale ttyd on ${p} (pid=${pid})`);
          } catch { /* already dead */ }
        }
      }
    } catch { /* 端口空闲 */ }
  }
  return n;
}

export async function createSession(
  label: string, command: string, cwd: string, keepShell = true
): Promise<SessionInfo | null> {
  const port = await acquireFreePort();
  if (port === null) {
    console.error('[TTYD] No available ports in pool');
    return null;
  }

  const effectiveCwd = cwd || getTerminalDefaultCwd();
  const runId = `${port}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const mark = sessionMarkPath(runId);
  const proc = spawnTTYD(port, { cmd: command || undefined, cwd: effectiveCwd || undefined, keepShell, runId });
  // 两种模式都登记 run-once 标记(交互终端同样只跑一次命令);清理统一走 releasePort
  sessionMarks.set(port, mark);

  const info: SessionInfo = {
    port,
    label,
    command,
    cwd,
    createdAt: Date.now(),
  };

  sessionMap.set(port, { process: proc, info });

  // 等待 ttyd 端口就绪，确保 iframe 能立即连接
  const ready = await waitForPort(port);
  if (!ready) {
    console.error(`[TTYD] Session port ${port} failed to start in time`);
    try { proc.kill('SIGTERM'); } catch {}
    releasePort(port, proc);
    return null;
  }

  proc.on('exit', () => {
    releasePort(port, proc);
    console.log(`[TTYD:${port}] session ended`);
  });

  // 一次性会话:命令跑完自动回收 ttyd(否则进程/端口/会话永久残留,见函数注释)
  // 交互会话(keepShell)不回收 —— 窗口常驻,由用户关窗口/前端主动 kill 收尾。
  if (!keepShell) watchOneshotExit(proc, mark);

  return info;
}

export function killSession(port: number): boolean {
  const session = sessionMap.get(port);
  if (!session) return false;

  try {
    session.process.kill('SIGTERM');
  } catch { /* already dead */ }
  releasePort(port, session.process);
  return true;
}

export function getSessions(): SessionInfo[] {
  return Array.from(sessionMap.values()).map(s => s.info);
}

export function killAllSessions(): void {
  for (const [port, session] of sessionMap) {
    try { session.process.kill('SIGTERM'); } catch {}
    releasePort(port, session.process);
  }
}

// ── 兼容旧 API ───────────────────────────────────────────

export function startTTYD(): void {
  startFABTTYD();
}

export function stopTTYD(): void {
  stopFABTTYD();
  killAllSessions();
}
