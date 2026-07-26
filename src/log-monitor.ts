// ── Log file monitor + Port check + SSE broadcast ─────────

import fs from 'fs';
import net from 'net';
import type { Response } from 'express';
import type { FileState, SseMessage, LogEntry } from './types';
import { getAllLogEntries } from './log-config-store';

const POLL_MS = 500;
const PORT_CHECK_MS = 5000;     // ★ 5 秒后台轮询端口
const INITIAL_KB = 80;
const ACTIVE_THRESHOLD = 5000;   // 5 秒内有写入 = 活跃

/** 文件状态缓存 */
const fileState: Record<string, FileState> = {};

/** SSE 客户端列表 */
let clients: Response[] = [];

/** 端口存活缓存: port → { alive, ts } */
const portStatusCache: Map<number, { alive: boolean; ts: number }> = new Map();

// ── 获取所有日志文件（从 SQLite 读取） ───────────────────

export function getAllLogs(): LogEntry[] {
  return getAllLogEntries();
}

// ── 清理已从配置中移除的文件状态 ─────────────────────────

function cleanStaleStates(logs: LogEntry[]): void {
  const activeFiles = new Set(logs.map(l => l.file));
  for (const fp of Object.keys(fileState)) {
    if (!activeFiles.has(fp)) delete fileState[fp];
  }
}

// ── 文件轮询（500ms）──────────────────────────────────────

function poll(): void {
  const logs = getAllLogs();
  cleanStaleStates(logs);
  const now = Date.now();
  const batch: SseMessage[] = [];

  for (const log of logs) {
    const fp = log.file;
    let ok = false, mt = 0, sz = 0;
    try { const st = fs.statSync(fp); ok = true; mt = st.mtimeMs; sz = st.size; } catch { /* 文件不存在 */ }

    const prev = fileState[fp];
    let nt = '', ch = false;

    if (!prev) {
      // 首次遇到这个文件
      fileState[fp] = { mtime: mt, size: sz, pos: 0, lastActive: ok ? now : 0 };
      if (ok && sz > 0) {
        nt = readTail(fp, sz);
        fileState[fp].pos = sz;
      }
    } else if (ok) {
      if (mt !== prev.mtime || sz !== prev.size) {
        ch = true;
        let pos = prev.pos;
        // 处理日志 rotate/truncate
        if (sz < pos) pos = 0;
        const len = sz - pos;
        if (len > 0) {
          try {
            const fd = fs.openSync(fp, 'r');
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, pos);
            fs.closeSync(fd);
            nt = buf.toString('utf8');
          } catch { nt = ''; }
        }
        fileState[fp] = { mtime: mt, size: sz, pos: sz, lastActive: now };
      }
    } else if (prev.mtime > 0) {
      // 文件被删除
      fileState[fp] = { mtime: 0, size: 0, pos: 0, lastActive: 0 };
    }

    if (nt || ch) {
      batch.push({ file: fp, name: log.name, exists: ok, content: nt, changed: ch, timestamp: now });
    }
  }

  // 批量广播：一次 poll 周期内的所有变更合并为一条 SSE 消息
  broadcastBatch(batch);
}

/** 读取文件末尾最多 INITIAL_KB */
function readTail(fp: string, sz?: number): string {
  try {
    const size = sz ?? fs.statSync(fp).size;
    const fd = fs.openSync(fp, 'r');
    const start = size > INITIAL_KB * 1024 ? size - INITIAL_KB * 1024 : 0;
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

// ── SSE 广播 ─────────────────────────────────────────────

/** 发送单条 SSE 消息（端口状态） */
function broadcast(data: SseMessage | PortStatusMessage): void {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients = clients.filter(res => {
    try { res.write(msg); return true; }
    catch { return false; }
  });
}

/** 批量发送日志变更（减少 JSON.stringify + write 次数） */
function broadcastBatch(messages: SseMessage[]): void {
  if (!messages.length) return;
  const msg = `data: ${JSON.stringify(messages)}\n\n`;
  clients = clients.filter(res => {
    try { res.write(msg); return true; }
    catch { return false; }
  });
}

// ── 端口存活检测（5 秒后台轮询）───────────────────────────

interface PortStatusMessage {
  type: 'port-status';
  ports: Record<number, boolean>;  // port → alive
}

/** TCP 端口存活检测（单次） */
function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, '127.0.0.1');
  });
}

/** 轮询所有日志条目的端口 */
async function checkAllPorts(): Promise<void> {
  const logs = getAllLogs();
  const uniquePorts = [...new Set(logs.map(l => l.port).filter(Boolean))] as number[];
  if (!uniquePorts.length) return;

  const results = await Promise.allSettled(
    uniquePorts.map(async (port) => {
      const alive = await checkPort(port);
      const prev = portStatusCache.get(port);
      portStatusCache.set(port, { alive, ts: Date.now() });

      // 状态变更时广播
      if (!prev || prev.alive !== alive) {
        return { port, alive, changed: true };
      }
      return { port, alive, changed: false };
    })
  );

  // 构建广播消息
  const changed: Record<number, boolean> = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.changed) {
      changed[r.value.port] = r.value.alive;
    }
  }
  if (Object.keys(changed).length > 0) {
    broadcast({ type: 'port-status', ports: changed });
  }

  // 清理已删除端口的缓存
  const activePorts = new Set(uniquePorts);
  for (const port of portStatusCache.keys()) {
    if (!activePorts.has(port)) portStatusCache.delete(port);
  }
}

/** 获取端口存活状态 */
export function getPortStatus(port: number): boolean {
  return portStatusCache.get(port)?.alive ?? false;
}

/** 清空文件状态缓存（文件被 truncate 后调用） */
export function clearFileState(fp: string): void {
  delete fileState[fp];
}

/** 按活跃度排序的日志列表（供 API 使用） */
export async function getLogsSorted(): Promise<Array<LogEntry & { exists: boolean; size: number; active: boolean; alive: boolean }>> {
  const now = Date.now();
  const logs = getAllLogs();

  return logs.map(log => {
    let exists = false, size = 0;
    try { const st = fs.statSync(log.file); exists = true; size = st.size; } catch { /* */ }
    const st = fileState[log.file];
    const active = (now - (st ? st.lastActive : 0)) < ACTIVE_THRESHOLD;
    const port = log.port ?? undefined;
    const alive = port ? getPortStatus(port) : false;
    return { ...log, exists, size, active, port, alive };
  }).sort((a, b) => {
    // alive 排最前
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    const sa = fileState[a.file];
    const sb = fileState[b.file];
    return (sb?.lastActive || 0) - (sa?.lastActive || 0);
  });
}

// ── SSE 连接管理 ─────────────────────────────────────────

export function addClient(res: Response): void {
  clients.push(res);
}

export function removeClient(res: Response): void {
  clients = clients.filter(c => c !== res);
}

// ── 读取指定文件内容（供 API 使用） ───────────────────────

export function readFileContent(fp: string): { content: string; size: number } {
  let sz: number;
  try { sz = fs.statSync(fp).size; } catch { return { content: '', size: 0 }; }

  const content = readTail(fp, sz);

  // 更新 pos 防止 SSE 重复推送已读内容
  if (!fileState[fp]) fileState[fp] = { mtime: 0, size: sz, pos: sz, lastActive: 0 };
  else fileState[fp].pos = sz;

  return { content, size: sz };
}

// ── 启动 ─────────────────────────────────────────────────

export function startMonitor(): void {
  setInterval(poll, POLL_MS);
  // ★ 5 秒后台端口轮询
  checkAllPorts(); // 启动时立即检测一次
  setInterval(checkAllPorts, PORT_CHECK_MS);
}
