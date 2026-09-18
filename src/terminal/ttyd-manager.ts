// ── TTYD Process Manager (v2 — multi-session) ──────────────
//   端口 9001: FAB 浮动终端（持久 session）
//   端口 9002-9011: 命令终端（动态分配，页面级生命周期）

import { spawn, execSync, ChildProcess } from 'child_process';
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

export function getTTYDStatus(): { status: string; port: number; retryCount: number } {
  return {
    status: fabState.status,
    port: fabState.port,
    retryCount: fabState.retryCount,
  };
}

function spawnTTYD(port: number, opts?: { cmd?: string; cwd?: string; keepShell?: boolean }): ChildProcess {
  const config = getConfig();
  const shell = config.ttyd?.command ?? 'bash';
  const extraArgs = config.ttyd?.args ? config.ttyd.args.split(/\s+/) : ['-W'];

  let spawnArgs: string[];
  if (opts?.cmd || opts?.cwd) {
    const cdPart = opts.cwd ? `cd ${opts.cwd} && ` : '';
    const cmd = opts.cmd || `exec ${shell}`;
    // keepShell=true(默认):执行完命令再起交互 shell,窗口常驻(命令终端用)。
    // keepShell=false(一次性):命令跑完即退出 → ttyd 关闭 → 端口自动回收(Apps 启停用,不留残留窗口)。
    const keepShell = opts?.keepShell !== false;
    spawnArgs = keepShell
      ? ['-p', String(port), ...extraArgs, shell, '-c', `${cdPart}${cmd}; exec ${shell}`]
      : ['-p', String(port), ...extraArgs, shell, '-c', `${cdPart}${cmd}`];
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

  proc.on('exit', (code: number | null, signal: string | null) => {
    console.log(`[TTYD:FAB] exited (code=${code}, signal=${signal})`);
    fabState.process = null;

    if (fabState.status === 'stopped') return;

    if (fabState.retryCount < MAX_RETRIES) {
      fabState.retryCount++;
      fabState.status = 'restarting';
      console.log(`[TTYD:FAB] restarting (attempt ${fabState.retryCount}/${MAX_RETRIES})...`);
      setTimeout(() => {
        fabState.process = spawnFABTTYD();
        fabState.status = 'running';
        fabState.retryCount = 0;
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

function releasePort(port: number): void {
  usedPorts.delete(port);
  sessionMap.delete(port);
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
  const proc = spawnTTYD(port, { cmd: command || undefined, cwd: effectiveCwd || undefined, keepShell });

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
    releasePort(port);
    return null;
  }

  proc.on('exit', () => {
    releasePort(port);
    console.log(`[TTYD:${port}] session ended`);
  });

  return info;
}

export function killSession(port: number): boolean {
  const session = sessionMap.get(port);
  if (!session) return false;

  try {
    session.process.kill('SIGTERM');
  } catch { /* already dead */ }
  releasePort(port);
  return true;
}

export function getSessions(): SessionInfo[] {
  return Array.from(sessionMap.values()).map(s => s.info);
}

export function killAllSessions(): void {
  for (const [port, session] of sessionMap) {
    try { session.process.kill('SIGTERM'); } catch {}
    releasePort(port);
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
