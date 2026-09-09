// ── Redis 客户端管理(单连接按 (project,connId,db) 缓存;镜像 connector.ts 的池语义)──
//   面板单人使用无需连接池;lazyConnect 按需建连,失败快(maxRetriesPerRequest:1)。

import Redis from 'ioredis';

export interface RedisTarget {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

const clients: Map<string, Redis> = new Map();

function clientKey(projectId: string, connId: string, db?: number): string {
  return `${projectId}:${connId}:${db ?? 0}`;
}

export function getRedisClient(projectId: string, connId: string, target: RedisTarget): Redis {
  const db = target.db ?? 0;
  const key = clientKey(projectId, connId, db);
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new Redis({
    host: target.host || '127.0.0.1',
    port: target.port || 6379,
    password: target.password || undefined,
    db,
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: (tries) => Math.min(tries * 500, 3000),
    enableOfflineQueue: false,
  });
  // 吞掉后台 error 事件(不挂 unhandled):错误语义由调用方 await 捕获
  client.on('error', () => {});
  clients.set(key, client);
  return client;
}

/** 配置增删改后失效某连接的全部 db 客户端(quit + 删缓存) */
export async function invalidateRedisClient(projectId: string, connId: string): Promise<void> {
  const prefix = `${projectId}:${connId}:`;
  for (const [key, client] of clients) {
    if (!key.startsWith(prefix)) continue;
    clients.delete(key);
    try { client.disconnect(); } catch { /* ignore */ }
  }
}

/** 进程退出时关闭全部 */
export function closeAllRedis(): void {
  for (const [, client] of clients) {
    try { client.disconnect(); } catch { /* ignore */ }
  }
  clients.clear();
}
