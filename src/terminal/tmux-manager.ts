// ── Tmux Session Manager(持久化终端)────────────────────────
//   tmux session 常驻:刷新页面/重启后端都不死,ttyd 只是临时接入通道,
//   断开(attach)即销毁通道、随时可重连。接入端口段 9020-9029,
//   与 ttyd-manager 的 9001 / 9002-9011 分开,互不干扰。
//
//   ★ 项目模型:物理 tmux 会话名统一加前缀 p_<projectId>_<safeName>,
//     做项目隔离(UI 展示时去掉前缀)。会话备注(展示名/描述/归属项目)
//     不落全局文件,而是放在「归属项目」的 .code-panel/data/tmux-notes.json,
//     随项目走(项目被删则备注一并消失;tmux 会话本身是宿主机全局的)。

import { spawn, exec, execSync, ChildProcess } from 'child_process';
import * as net from 'net';
import type { ProjectRow } from '../db/global-store';
import { allProjects, readRuntimeJson, writeRuntimeJson } from '../projects/project-store';
import { getConfig } from '../config-manager';

// ── 常量 ───────────────────────────────────────────────

const TMUX_PORT_START = 9020;
const TMUX_PORT_END = 9029;

/** 会话名白名单 —— 创建/attach 前校验,防命令注入 */
const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** 物理会话名(带 p_ 前缀)校验 —— 长度放宽到 200(前缀 + projectId + 展示名) */
const FULL_NAME_RE = /^p_[a-zA-Z0-9_-]{1,198}$/;

/** 备注文件:随项目存 <root>/.code-panel/data/tmux-notes.json */
const NOTES_REL = 'tmux-notes.json';

/** 会话备注(存于项目 runtime json) */
export interface TmuxNote {
  name: string;        // 展示名(safe name,去前缀后给 UI 看)
  project: string;     // 归属项目 id
  description: string; // 用户备注(可为空)
}

type TmuxNotes = Record<string /* 物理会话名(fullName) */, TmuxNote>;

interface TmuxAttach {
  process: ChildProcess;
  sessionName: string; // 物理 tmux 会话名
  port: number;
  createdAt: number;
}

const usedPorts = new Set<number>();
const attachMap = new Map<number, TmuxAttach>();

// ── exec helper ──────────────────────────────────────────

export function execAsync(cmd: string, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || '').trim() || err.message));
      else resolve((stdout || '').trim());
    });
  });
}

// ── 会话名编码 ────────────────────────────────────────────
//   物理名 = p_<projectId>_<safeName>,宿主全局唯一。

export function tmuxFullName(projectId: string, safeName: string): string {
  return `p_${projectId}_${safeName}`;
}

/** 把用户输入解析成物理会话名:已是 p_<project>_ 前缀就直接用,否则补前缀 */
export function resolveTmuxName(project: ProjectRow, name: string): string {
  const prefix = `p_${project.id}_`;
  return name.startsWith(prefix) ? name : prefix + name;
}

/** 校验 safe name,非法抛错;通过则返回物理会话名 */
export function assertSafeSessionName(project: ProjectRow, name: string): string {
  if (!name || !name.trim()) throw new Error('请提供会话名称');
  const safe = name.trim();
  if (!SESSION_NAME_RE.test(safe)) {
    throw new Error('名称仅允许字母、数字、下划线、连字符(≤64 字符)');
  }
  return tmuxFullName(project.id, safe);
}

// ── 备注读写(随项目 data/)────────────────────────────────

function readNotes(project: ProjectRow): TmuxNotes {
  return readRuntimeJson<TmuxNotes>(project, NOTES_REL, {});
}

function writeNotes(project: ProjectRow, notes: TmuxNotes): void {
  writeRuntimeJson(project, NOTES_REL, notes);
}

/** 全项目备注聚合成一张表(物理名 → 备注) */
function aggregatedNotes(): Map<string, TmuxNote> {
  const map = new Map<string, TmuxNote>();
  for (const p of allProjects()) {
    const ns = readNotes(p);
    for (const [full, note] of Object.entries(ns)) map.set(full, note);
  }
  return map;
}

// ── 端口分配(9020-9029)─────────────────────────────────

function allocatePort(): number | null {
  for (let p = TMUX_PORT_START; p <= TMUX_PORT_END; p++) {
    if (!usedPorts.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  return null;
}

function releasePort(port: number): void {
  usedPorts.delete(port);
  attachMap.delete(port);
}

/** 等待 ttyd attach 端口就绪后再响应前端 */
function waitForPortReady(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 100);
        else resolve(false);
      });
    };
    attempt();
  });
}

// ── 会话列表(宿主全局 + 备注合并)────────────────────────

export interface TmuxSessionInfo {
  name: string;            // 展示名(去前缀;无备注无前缀时为物理名)
  fullName: string;        // 物理 tmux 会话名(UI 用这个名字做 key / attach / delete)
  project: string | null;  // 归属项目 id(未识别前缀 → null)
  description: string;     // 备注(可空)
  windows: number;
  createdAt: number;       // ms
  attached: boolean;       // 当前是否有 tmux client 连着(含我们自己的 ttyd 接入)
}

export async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
  // tmux 未启动会抛错 → 空列表
  const raw = await execAsync(
    `tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}' 2>/dev/null`,
  );
  if (!raw) return [];

  const notesMap = aggregatedNotes();
  // 识别前缀时用更长的 projectId 优先,减少 p_a 与 p_a_b 这类歧义
  const projects = allProjects().slice().sort((a, b) => b.id.length - a.id.length);

  return raw.split('\n').filter(Boolean).map(line => {
    const [fullName, windows, createdAt, attached] = line.split('|');

    const note = notesMap.get(fullName);
    let name = fullName;
    let project: string | null = null;
    let description = '';
    if (note) {
      name = note.name;
      project = note.project || null;
      description = note.description || '';
    } else {
      for (const p of projects) {
        const prefix = `p_${p.id}_`;
        if (fullName.startsWith(prefix)) {
          project = p.id;
          name = fullName.slice(prefix.length);
          break;
        }
      }
    }

    return {
      name,
      fullName,
      project,
      description,
      windows: parseInt(windows, 10) || 0,
      createdAt: (parseInt(createdAt, 10) || 0) * 1000,
      attached: attached === '1',
    };
  });
}

// ── 创建会话 ────────────────────────────────────────────
//   只创建 detached tmux session;备注落本项目 runtime json。

export async function createTmuxSession(
  project: ProjectRow, name: string, description?: string,
): Promise<string> {
  const fullName = assertSafeSessionName(project, name);

  // 重名检查(tmux 未启动 → 说明还没有会话,放行)
  try {
    const existing = await execAsync(`tmux list-sessions -F '#{session_name}' 2>/dev/null`);
    if (existing.split('\n').includes(fullName)) {
      throw new Error(`会话「${name}」已存在`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('已存在')) throw err;
    // tmux 无会话 → 继续创建
  }

  await execAsync(`tmux new-session -d -s "${fullName}"`);
  const notes = readNotes(project);
  notes[fullName] = {
    name: name.trim(),
    project: project.id,
    description: (description || '').trim(),
  };
  writeNotes(project, notes);
  return fullName;
}

// ── 连接会话:为已有 tmux session 启动 ttyd attach ───────
//   同会话已在本进程接入 → 复用端口,避免刷页面后堆叠多个 ttyd。

export async function startTmuxAttach(project: ProjectRow, name: string): Promise<number> {
  if (!name || !name.trim()) throw new Error('请提供会话名称');
  const raw = name.trim();
  // name 可能是 UI 传来的物理名(p_<project>_<name>)或展示名 → 统一解析成物理名
  const session = resolveTmuxName(project, raw);
  // 物理名整体校验;若传的是展示名,再按展示名规则校验一次
  if (!FULL_NAME_RE.test(session) || (!raw.startsWith(`p_${project.id}_`) && !SESSION_NAME_RE.test(raw))) {
    throw new Error('名称仅允许字母、数字、下划线、连字符');
  }

  // 复用已存在的接入(后端重启后 attachMap 为空,此处不会命中)
  for (const [port, attach] of attachMap) {
    if (attach.sessionName === session) return port;
  }

  // 确认 tmux 会话存在
  const existing = await execAsync(`tmux list-sessions -F '#{session_name}' 2>/dev/null`);
  if (!existing.split('\n').includes(session)) {
    throw new Error(`tmux 会话「${session}」不存在`);
  }

  const port = allocatePort();
  if (port === null) {
    throw new Error('Tmux 接入端口池已满(9020-9029),请先断开一些连接');
  }

  const config = getConfig();
  const shell = config.ttyd?.command ?? 'bash';

  // ttyd attach 到 tmux session;exec 替换 bash 减少进程层级。
  // 断开(页面关闭/用户 Ctrl+D)只杀 ttyd,tmux session 常驻。
  const proc = spawn('ttyd', [
    '-i', '127.0.0.1',
    '-p', String(port),
    '-W',
    shell, '-c', `exec tmux attach -t "${session}"`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr?.on('data', (data: Buffer) => {
    console.error(`[TTYD-TMUX:${port}] ${data.toString().trim()}`);
  });
  proc.on('error', (err: Error) => {
    console.error(`[TTYD-TMUX:${port}] spawn error: ${err.message}`);
  });

  // 等端口就绪后再返回,前端 iframe 立即能连上
  const ready = await waitForPortReady(port);
  if (!ready) {
    try { proc.kill('SIGTERM'); } catch { /* already dead */ }
    releasePort(port);
    throw new Error(`ttyd 未能在 3s 内启动(端口 ${port})`);
  }

  attachMap.set(port, { process: proc, sessionName: session, port, createdAt: Date.now() });
  proc.on('exit', () => { releasePort(port); });
  return port;
}

// ── 断开连接:只杀 ttyd 接入,不动 tmux session ────────────

/** 同步杀掉所有 ttyd 接入(graceful shutdown 用)——tmux session 不受影响 */
export function killAllTmuxAttachSync(): number {
  let n = 0;
  for (const [port, attach] of attachMap) {
    try { attach.process.kill('SIGTERM'); } catch { /* already dead */ }
    releasePort(port);
    n++;
  }
  return n;
}

export async function stopTmuxAttach(port: number): Promise<boolean> {
  // 端口保护:只处理本模块端口池(9020-9029),避免误杀 9001/9002-9011
  if (port < TMUX_PORT_START || port > TMUX_PORT_END) return false;

  const attach = attachMap.get(port);
  if (attach) {
    try { attach.process.kill('SIGTERM'); } catch { /* already dead */ }
    releasePort(port);
    return true;
  }
  // 未被 tracked(跨重启遗留):尽力按端口清理 ttyd 进程
  try {
    await execAsync(`kill $(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true`, 3000);
  } catch { /* best-effort */ }
  return false;
}

// ── 删除会话:断开该会话所有 ttyd + kill tmux session + 清备注 ──

export async function killTmuxSession(project: ProjectRow, name: string): Promise<void> {
  const raw = name.trim();
  const session = resolveTmuxName(project, raw);
  if (!FULL_NAME_RE.test(session) || (!raw.startsWith(`p_${project.id}_`) && !SESSION_NAME_RE.test(raw))) {
    throw new Error('会话名非法');
  }
  // 先断开该会话上的所有 ttyd 接入
  for (const [port, attach] of attachMap) {
    if (attach.sessionName === session) {
      try { attach.process.kill('SIGTERM'); } catch { /* already dead */ }
      releasePort(port);
    }
  }
  await execAsync(`tmux kill-session -t "${session}" 2>/dev/null || true`, 5000);
  // 清备注(从本项目 runtime json)
  const notes = readNotes(project);
  if (notes[session] !== undefined) {
    delete notes[session];
    writeNotes(project, notes);
  }
}

// ── 启动清理:杀上次服务器残留的 ttyd attach(9020-9029)──
//   tmux session 本身保留(常驻),重启后端后前端手动重连即可。

export function cleanupStaleTmuxAttachPorts(): number {
  let n = 0;
  for (let p = TMUX_PORT_START; p <= TMUX_PORT_END; p++) {
    try {
      const out = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (!out) continue;
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (pid && pid !== process.pid) {
          try { process.kill(pid, 'SIGTERM'); n++; console.log(`[TTYD-TMUX] cleanup stale ttyd on ${p} (pid=${pid})`); }
          catch { /* already dead */ }
        }
      }
    } catch { /* 端口空闲 */ }
  }
  return n;
}
