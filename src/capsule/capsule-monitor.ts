// ── 时空胶囊监听器(轮询 + 稳定判定 + SSE 广播)──────────
//   职责单一:盯住胶囊目录,条目「写完」(3 秒无变化)时推一次 SSE。
//   目录/扫描/回收站在 capsule-store.ts;wiki git 在 wiki-manager.ts。
//
//   轮询 1s + 稳定判定 3s:AI 渐进写入(先建后补)只在停笔 3s 后
//   推送一次,防「半成品通知」。首轮基线:启动时已存在的条目直接
//   视为已通知(服务重启不把旧胶囊全弹一遍)。
//
//   SSE 消息:{type:'capsule', event:'new'|'update', capsule:{...}}
//   (全局资源,不分项目;条目删除不推送,以 list 为准)。

import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { capsuleDir, statCapsuleEntry, cleanTrash, type CapsuleEntry } from './capsule-store';
import { createSseClients } from '../utils/sse-clients';

interface CapsuleState {
  entry: CapsuleEntry;
  dirMtime: number;      // 目录条目自身的 mtime(短路键:未变则不 walk 内部)
  lastChangeTs: number;
  everNotified: boolean; // 推送过至少一次(决定下次事件是 update 而非 new)
  pending: boolean;      // 有未推送的变化(稳定后推一次即清)
}

const POLL_MS = 1000;
const STABLE_MS = 3000;
/** 每隔多少轮 poll 清理一次回收站(60 轮 ≈ 1 分钟) */
const TRASH_CLEAN_EVERY = 60;

/** 基线轮标志:该轮新看到的条目直接视为已通知(启动/重置时不轰炸旧胶囊) */
let baselineFlag = false;

// ── SSE 客户端管理(集合实现见 utils/sse-clients,与 log-monitor 同源)──

const sse = createSseClients();

export function addCapsuleClient(res: Response): void {
  sse.add(res);
}

export function removeCapsuleClient(res: Response): void {
  sse.remove(res);
}

function broadcastCapsule(event: 'new' | 'update', capsule: CapsuleEntry): void {
  sse.broadcast(`data: ${JSON.stringify({ type: 'capsule', event, capsule })}\n\n`);
}

// ── 轮询主体 ─────────────────────────────────────────────

let states = new Map<string, CapsuleState>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollCount = 0;

function poll(): void {
  // 回收站过期清理(节流:约 1 分钟一次)
  if (++pollCount % TRASH_CLEAN_EVERY === 0) cleanTrash();

  const dir = capsuleDir();
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { states.clear(); return; }

  const now = Date.now();
  const next = new Map<string, CapsuleState>();

  for (const name of names) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const prev = states.get(name);

    // 短路:目录条目自身 mtime 未变 → 沿用上轮结果,不 walk 内部
    let entry: CapsuleEntry | null = null;
    let dirMtime = 0;
    if (prev) {
      try {
        const st = fs.statSync(p);
        dirMtime = st.mtimeMs;
        if (prev.entry.kind === 'dir' && st.mtimeMs === prev.dirMtime) {
          entry = { ...prev.entry };
        }
      } catch { /* 条目消失 → 让 statCapsuleEntry 兜底 */ }
    }
    if (!entry) {
      entry = statCapsuleEntry(p, name);
      if (!entry) continue;
      if (entry.kind === 'dir') {
        try { dirMtime = fs.statSync(p).mtimeMs; } catch { /* 忽略 */ }
      }
    }

    // 基线轮:已存在的条目直接视为已通知,不进入稳定判定
    if (!prev && baselineFlag) {
      next.set(name, { entry, dirMtime, lastChangeTs: now, everNotified: true, pending: false });
      continue;
    }

    const changed = !prev
      || prev.entry.mtime !== entry.mtime
      || prev.entry.size !== entry.size
      || prev.entry.fileCount !== entry.fileCount;

    next.set(name, {
      entry,
      dirMtime,
      lastChangeTs: changed ? now : prev!.lastChangeTs,
      everNotified: changed ? prev?.everNotified ?? false : prev!.everNotified,
      pending: changed ? true : prev!.pending,
    });
  }

  // 稳定判定:变化停 ≥3s 且还没推过 → 推一次
  for (const st of next.values()) {
    if (st.pending && now - st.lastChangeTs >= STABLE_MS) {
      st.pending = false;
      broadcastCapsule(st.everNotified ? 'update' : 'new', st.entry);
      st.everNotified = true;
    }
  }

  states = next; // 消失的条目随旧 Map 丢弃(不推 removed,list 为准)
}

/** 启动监听(server.ts 调用)。首轮 = 基线:已有条目全部视为已通知 */
export function startCapsuleMonitor(): void {
  if (pollTimer) return;
  cleanTrash(); // 启动顺带清一次过期回收站
  baselineFlag = true;
  poll();
  baselineFlag = false;
  pollTimer = setInterval(poll, POLL_MS);
}

/** 重置(改配置目录/删除/恢复条目后):清状态重新基线,不轰炸通知 */
export function resetCapsuleMonitor(): void {
  states.clear();
  baselineFlag = true;
  poll();
  baselineFlag = false;
}
