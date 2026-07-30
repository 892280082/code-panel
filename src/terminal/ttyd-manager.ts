// ── TTYD Process Manager (v2 — multi-session) ──────────────
//   端口 9001: FAB 浮动终端（持久 session）
//   端口 9002-9011: 命令终端（动态分配，页面级生命周期）

import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import { getConfig, getTerminalDefaultCwd } from '../config-manager';

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

function spawnTTYD(port: number, opts?: { cmd?: string; cwd?: string }): ChildProcess {
  const config = getConfig();
  const shell = config.ttyd?.command ?? 'bash';
  const extraArgs = config.ttyd?.args ? config.ttyd.args.split(/\s+/) : ['-W'];

  let spawnArgs: string[];
  if (opts?.cmd || opts?.cwd) {
    const cdPart = opts.cwd ? `cd ${opts.cwd} && ` : '';
    const cmd = opts.cmd || `exec ${shell}`;
    spawnArgs = ['-p', String(port), ...extraArgs, shell, '-c', `${cdPart}${cmd}; exec ${shell}`];
  } else {
    spawnArgs = ['-p', String(port), ...extraArgs, shell];
  }

  console.log(`[TTYD] starting on port ${port}: ttyd ${spawnArgs.join(' ')}`);

  const proc = spawn('ttyd', spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
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

export async function createSession(
  label: string, command: string, cwd: string
): Promise<SessionInfo | null> {
  const port = allocatePort();
  if (port === null) {
    console.error('[TTYD] No available ports in pool');
    return null;
  }

  const effectiveCwd = cwd || getTerminalDefaultCwd();
  const proc = spawnTTYD(port, { cmd: command || undefined, cwd: effectiveCwd || undefined });

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
