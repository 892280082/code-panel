// ── Log file monitor + Port check + SSE broadcast ─────────
//   数据源 = 全部已注册项目的 logs.yaml(sections 平铺,条目带 projectId)。
//   SSE 按项目过滤:每条日志推送带 project 字段,客户端只收所属项目的文件。

import fs from 'fs';
import net from 'net';
import type { Response } from 'express';
import type { FileState, SseMessage, LogEntry } from './types';
import type { ProjectRow } from './db/global-store';
import { allProjects } from './projects/project-store';
import { logsFlatEntries } from './projects/adapters';

const POLL_MS = 500;
const PORT_CHECK_MS = 5000;     // ★ 5 秒后台轮询端口
const INITIAL_KB = 80;
const ACTIVE_THRESHOLD = 5000;   // 5 秒内有写入 = 活跃

/** 文件状态缓存 */
const fileState: Record<string, FileState> = {};

/** SSE 客户端列表(每个绑定所属 project;全局 port-status 推送仍广播全部) */
interface SseClient { res: Response; project?: string }
let clients: SseClient[] = [];

/** 端口存活缓存: port → { alive, ts } */
const portStatusCache: Map<number, { alive: boolean; ts: number }> = new Map();

// ── 获取所有日志文件(全部项目 logs.yaml 并集,带 projectId) ──

interface MonitoredLog extends LogEntry {
  platform: string;
  side?: string;
  projectId: string;
}

function getAllLogs(): MonitoredLog[] {
  const out: MonitoredLog[] = [];
  for (const p of allProjects()) {
    for (const e of logsFlatEntries(p)) {
      out.push({ name: e.name, file: e.file, port: e.port, platform: e.platform, side: e.side, projectId: p.id });
    }
  }
  return out;
}

// ── 清理已从配置中移除的文件状态 ─────────────────────────

function cleanStaleStates(logs: MonitoredLog[]): void {
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
      batch.push({ file: fp, name: log.name, exists: ok, content: nt, changed: ch, timestamp: now, project: log.projectId });
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

interface PortStatusMessage {
  type: 'port-status';
  ports: Record<number, boolean>;  // port → alive
}

function writeRaw(client: SseClient, msg: string): boolean {
  try { client.res.write(msg); return true; }
  catch { return false; }
}

/** 发送单条 SSE 消息（端口状态 — 全局,推给所有客户端） */
function broadcast(data: SseMessage | PortStatusMessage): void {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients = clients.filter(c => writeRaw(c, msg));
}

/** 批量发送日志变更 — 按客户端所属 project 过滤,防止跨项目串扰 */
function broadcastBatch(messages: SseMessage[]): void {
  if (!messages.length) return;
  // 按 project 预分组,减少重复 JSON.stringify
  const byProject = new Map<string | undefined, SseMessage[]>();
  for (const m of messages) {
    const key = m.project;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(m);
  }
  clients = clients.filter(c => {
    const list = byProject.get(c.project) || [];
    if (!list.length) return true;           // 没有属于该客户端的日志,保留连接
    return writeRaw(c, `data: ${JSON.stringify(list)}\n\n`);
  });
}

// ── 端口存活检测（5 秒后台轮询）───────────────────────────

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

/** 单项目日志列表(按活跃度排序,供 GET /api/logs?project 使用) */
export function getLogsSorted(project: ProjectRow): Array<{
  name: string; file: string; port?: number; platform: string; side?: string;
  exists: boolean; size: number; active: boolean; alive: boolean;
}> {
  const now = Date.now();
  return logsFlatEntries(project).map(e => {
    let exists = false, size = 0;
    try { const st = fs.statSync(e.file); exists = true; size = st.size; } catch { /* */ }
    const st = fileState[e.file];
    const active = (now - (st ? st.lastActive : 0)) < ACTIVE_THRESHOLD;
    const alive = e.port ? getPortStatus(e.port) : false;
    return { name: e.name, file: e.file, port: e.port, platform: e.platform, side: e.side, exists, size, active, alive };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ── SSE 连接管理 ─────────────────────────────────────────

export function addClient(res: Response, project?: string): void {
  clients.push({ res, project });
}

export function removeClient(res: Response): void {
  clients = clients.filter(c => c.res !== res);
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
