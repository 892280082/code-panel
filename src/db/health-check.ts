// ── Database health check — periodic connection test ─────

import { getDatabases } from '../config-manager';
import { testConnection } from './connector';

const CHECK_INTERVAL = 60_000; // 1 分钟

interface HealthStatus {
  alive: boolean;
  error?: string;
  serverVersion?: string;
  lastCheck: number; // timestamp
}

/** 健康状态缓存: dbId → HealthStatus */
const statusCache: Map<string, HealthStatus> = new Map();

/** 获取所有数据库的健康状态 */
export function getHealthStatuses(): Map<string, HealthStatus> {
  return statusCache;
}

/** 获取单个数据库的健康状态 */
export function getHealthStatus(dbId: string): HealthStatus | undefined {
  return statusCache.get(dbId);
}

/** 检查所有数据库连接，更新缓存 */
export async function checkAllDatabases(): Promise<void> {
  const dbs = getDatabases();
  const now = Date.now();

  const results = await Promise.allSettled(
    dbs.map(async (db) => {
      const result = await testConnection(db);
      return { dbId: db.id, result };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { dbId, result } = r.value;
      statusCache.set(dbId, {
        alive: result.ok,
        error: result.error,
        serverVersion: result.serverVersion,
        lastCheck: now,
      });
    }
  }

  // 清理已删除数据库的缓存
  const activeIds = new Set(dbs.map(d => d.id));
  for (const id of statusCache.keys()) {
    if (!activeIds.has(id)) statusCache.delete(id);
  }
}

/** 启动定时健康检查 */
export function startHealthCheck(): void {
  // 启动时立即检查一次
  checkAllDatabases();
  // 之后每分钟检查
  setInterval(checkAllDatabases, CHECK_INTERVAL);
}
