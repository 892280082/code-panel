// ── SQL review panel routes(审批按项目队列;review-mode 全局) ──

import { Router, Request, Response, NextFunction } from 'express';
import type { ProjectRow } from '../db/global-store';
import { requireProject, reqProject } from '../projects/context';
import { reqUser } from '../auth/jwt';
import { sqlConnection, redisConnection } from '../projects/adapters';
import { queueList, queueUpdate, queueGet, historyAdd } from '../projects/sql-store';
import { executeQuery, executeQueryDirect } from '../db/connector';
import { ensureRedisClient } from '../db/redis-client';
import { collectKeysByMatch } from '../redis/redis-ops';
import { getReviewMode, setReviewMode } from '../config-manager';
import { REVIEW_TOKEN, checkToken } from '../auth-token';
import type { SqlJobStatus } from '../types';
import { route } from '../utils/route-utils';

const router = Router();

/** 「AI 绝对禁止」端点硬拦:ai-token 免密通道(脚本)不得审批/拒绝/开关评审模式,
 *  也不得读 review-mode(响应里含 REVIEW_TOKEN 本体)。审批必须由人肉登录操作。 */
function denyAi(req: Request, res: Response, next: NextFunction): void {
  if (reqUser(req)?.via === 'ai-token') {
    res.status(403).json({ ok: false, error: '免密通道禁止审批类操作:请用户在 /sql 页面人工处理' });
    return;
  }
  next();
}


/** 获取数据库显示标签 */
function getDbLabel(project: ProjectRow, job: { dbId: string; connection?: { database?: string } }): string {
  if (job.connection?.database) return job.connection.database;
  return sqlConnection(project, job.dbId)?.name || job.dbId;
}

// 获取任务队列(项目内;支持 ?status=pending 筛选)
router.get('/api/sql/queue', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const status = typeof req.query.status === 'string' ? req.query.status as SqlJobStatus : undefined;
  const jobs = queueList(project, status);
  res.json({ ok: true, jobs, reviewMode: getReviewMode() });
}));

// 批准 → 执行 SQL(需令牌;项目内队列)
router.post('/api/sql/approve/:id', requireProject, denyAi, route(async (req: Request, res: Response) => {
  if (!checkToken((req.body as { token?: unknown })?.token)) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing token' });
  }
  const project = reqProject(req);
  const job = queueGet(project, String(req.params.id));
  if (!job) return res.status(404).json({ ok: false, error: `Job "${req.params.id}" not found` });
  if (job.status !== 'pending') return res.status(400).json({ ok: false, error: `Job is ${job.status}, not pending` });

  try {
    const dbLabel = getDbLabel(project, job);

    // Redis 危险操作(kind=redis):按载荷执行,复用同一审批流
    if (job.kind === 'redis' && job.redis) {
      const p = job.redis;
      const conn = redisConnection(project, p.connId);
      if (!conn) throw new Error(`Redis "${p.connId}" not found`);
      const client = await ensureRedisClient(project.id, conn.id, {
        host: conn.host, port: conn.port, password: conn.password,
        db: p.db ?? conn.db,
      });
      let affected = 0;
      if (p.action === 'flushdb') await client.flushdb();
      else if (p.action === 'flushall') await client.flushall();
      else if (p.action === 'delete-keys') {
        const keys = p.keys ?? (p.match ? await collectKeysByMatch(client, p.match, p.limit ?? 2000) : []);
        affected = await client.del(...keys);
      }
      queueUpdate(project, job.id, { status: 'executed', reviewedAt: Date.now(), result: { rows: [], affected, summary: `${p.action} done` } as any });
      return res.json({ ok: true, id: job.id, status: 'executed', result: { affected } });
    }

    if (job.connection) {
      const result = await executeQueryDirect(job.connection, job.sql);
      queueUpdate(project, job.id, { status: 'executed', reviewedAt: Date.now(), result });
      // 记录历史
      historyAdd(project, {
        title: job.title || job.reason, sql: job.sql, dbId: job.dbId, dbLabel, result, connection: job.connection,
      });
      return res.json({ ok: true, id: job.id, status: 'executed', result });
    }

    const dbConfig = sqlConnection(project, job.dbId);
    if (!dbConfig) {
      queueUpdate(project, job.id, { status: 'failed', reviewedAt: Date.now(), error: `Database "${job.dbId}" not found` });
      return res.status(404).json({ ok: false, error: `Database "${job.dbId}" not found` });
    }

    const result = await executeQuery(project.id, dbConfig, job.sql);
    queueUpdate(project, job.id, { status: 'executed', reviewedAt: Date.now(), result });
    // 记录历史
    historyAdd(project, {
      title: job.title || job.reason, sql: job.sql, dbId: job.dbId, dbLabel, result,
    });
    res.json({ ok: true, id: job.id, status: 'executed', result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    queueUpdate(project, job.id, { status: 'failed', reviewedAt: Date.now(), error: msg });
    res.json({ ok: false, id: job.id, status: 'failed', error: msg });
  }
}));

// 拒绝(需令牌;项目内队列)
router.post('/api/sql/reject/:id', requireProject, denyAi, route((req: Request, res: Response) => {
  if (!checkToken((req.body as { token?: unknown })?.token)) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing token' });
  }
  const project = reqProject(req);
  const job = queueGet(project, String(req.params.id));
  if (!job) return res.status(404).json({ ok: false, error: `Job "${req.params.id}" not found` });
  if (job.status !== 'pending') return res.status(400).json({ ok: false, error: `Job is ${job.status}, not pending` });

  const { reason } = (req.body ?? {}) as { reason?: string };
  queueUpdate(project, job.id, { status: 'rejected', reviewedAt: Date.now(), rejectReason: reason });
  res.json({ ok: true, id: job.id, status: 'rejected' });
}));

// 查看评审模式(全局,含令牌,供页面读取)
router.get('/api/sql/review-mode', denyAi, route((_req: Request, res: Response) => {
  res.json({ reviewMode: getReviewMode(), token: REVIEW_TOKEN });
}));

// 切换评审模式(全局,需令牌)
router.post('/api/sql/review-mode', denyAi, route((req: Request, res: Response) => {
  if (!checkToken((req.body as { token?: unknown })?.token)) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing token' });
  }
  const { enabled } = (req.body ?? {}) as { enabled: boolean };
  const reviewMode = setReviewMode(!!enabled);
  res.json({ ok: true, reviewMode });
}));

export default router;
