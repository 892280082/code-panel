// ── Database health check — 周期检测全部已注册项目的 sql.yaml 连接 ──
//   状态缓存 key = `projectId:dbId`(不同项目可同名 id)。

import { allProjects } from '../projects/project-store';
import type { ProjectRow } from './global-store';
import { sqlConnections } from '../projects/adapters';
import { testConnection } from './connector';

const CHECK_INTERVAL = 60_000; // 1 分钟

interface HealthStatus {
  alive: boolean;
  error?: string;
  serverVersion?: string;
  lastCheck: number; // timestamp
}

/** 健康状态缓存: `projectId:dbId` → HealthStatus */
const statusCache: Map<string, HealthStatus> = new Map();

export function healthKey(projectId: string, dbId: string): string {
  return `${projectId}:${dbId}`;
}

/** 获取所有健康状态(原始 map;key = projectId:dbId) */
export function getHealthStatuses(): Map<string, HealthStatus> {
  return statusCache;
}

/** 获取单个数据库健康状态(按项目 + dbId) */
export function getHealthStatus(projectId: string, dbId: string): HealthStatus | undefined {
  return statusCache.get(healthKey(projectId, dbId));
}

/** 检测一组项目连接,更新缓存 */
async function checkConnections(list: { projectId: string; conn: Parameters<typeof testConnection>[0] }[]): Promise<void> {
  const now = Date.now();
  const results = await Promise.allSettled(
    list.map(async ({ projectId, conn }) => {
      const result = await testConnection(conn, projectId);
      return { key: healthKey(projectId, conn.id), result };
    }),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { key, result } = r.value;
      statusCache.set(key, {
        alive: result.ok,
        error: result.error,
        serverVersion: result.serverVersion,
        lastCheck: now,
      });
    }
  }
}

/** 清理已不在任何项目配置里的缓存 */
function pruneStale(): void {
  const active = new Set<string>();
  for (const p of allProjects()) {
    for (const c of sqlConnections(p)) active.add(healthKey(p.id, c.id));
  }
  for (const key of statusCache.keys()) {
    if (!active.has(key)) statusCache.delete(key);
  }
}

/** 全量检查:所有已注册项目 */
export async function checkAllDatabases(): Promise<void> {
  const list: { projectId: string; conn: Parameters<typeof testConnection>[0] }[] = [];
  for (const p of allProjects()) {
    for (const c of sqlConnections(p)) list.push({ projectId: p.id, conn: c });
  }
  await checkConnections(list);
  pruneStale();
}

/** 只检测单个项目(手动刷新 /api/db/refresh?project) */
export async function checkProjectDatabases(project: ProjectRow): Promise<void> {
  await checkConnections(sqlConnections(project).map(c => ({ projectId: project.id, conn: c })));
}

/** 启动定时健康检查 */
export function startHealthCheck(): void {
  // 启动时立即检查一次
  checkAllDatabases();
  // 之后每分钟检查
  setInterval(checkAllDatabases, CHECK_INTERVAL);
}
