// ── SSE 客户端集合(连接管理 + 广播;log-monitor / capsule-monitor 共用)──
//   写失败的连接自动摘除;支持按 project 过滤(跨项目不串扰)。

import type { Response } from 'express';

export interface SseClient { res: Response; project?: string }

export function createSseClients(): {
  add: (res: Response, project?: string) => void;
  remove: (res: Response) => void;
  /** 广播一条已格式化消息(`data: ...\n\n`);filter 返回 false 的客户端保留连接不写 */
  broadcast: (msg: string, filter?: (c: SseClient) => boolean) => void;
} {
  let clients: SseClient[] = [];
  return {
    add(res, project) { clients.push({ res, project }); },
    remove(res) { clients = clients.filter(c => c.res !== res); },
    broadcast(msg, filter) {
      clients = clients.filter(c => {
        if (filter && !filter(c)) return true; // 非本条受众,保留连接
        try { c.res.write(msg); return true; } catch { return false; }
      });
    },
  };
}
