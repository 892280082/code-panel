// ── SQL execution routes — query + submit + status(按项目作用域) ──

import { Router, Request, Response } from 'express';
import type { ProjectRow } from '../db/global-store';
import { requireProject } from '../projects/context';
import { sqlConnection } from '../projects/adapters';
import { historyAdd, queueAdd, queueGet, queueUpdate } from '../projects/sql-store';
import { executeQuery, executeQueryDirect, isReadOnly } from '../db/connector';
import { getReviewMode } from '../config-manager';
import type { SubmitSqlBody, QuerySqlBody } from '../types';

const router = Router();

function reqProject(req: Request): ProjectRow {
  return (req as Request & { project: ProjectRow }).project;
}

/** 获取数据库显示标签(项目内查 sql.yaml) */
function getDbLabel(project: ProjectRow, dbId: string): string {
  return sqlConnection(project, dbId)?.name || dbId;
}

// 直接查询（SELECT 类）
router.post('/api/sql/query', requireProject, async (req: Request, res: Response) => {
  try {
    const project = reqProject(req);
    const { sql, dbId, title, connection } = (req.body ?? {}) as QuerySqlBody;
    if (!sql)   return res.status(400).json({ ok: false, error: 'sql is required' });
    if (!title) return res.status(400).json({ ok: false, error: 'title is required — explain why you are querying' });

    if (!isReadOnly(sql)) {
      return res.status(400).json({
        ok: false,
        error: 'Use POST /api/sql/submit for write operations (INSERT/UPDATE/DELETE). This endpoint only accepts SELECT.',
      });
    }

    let result: Awaited<ReturnType<typeof executeQuery>>;
    let dbLabel: string;

    // 内联连接参数优先
    if (connection) {
      result = await executeQueryDirect(connection, sql);
      dbLabel = connection.database || 'direct';
    } else {
      if (!dbId) return res.status(400).json({ ok: false, error: 'dbId or connection is required' });
      const dbConfig = sqlConnection(project, dbId);
      if (!dbConfig) return res.status(404).json({ ok: false, error: `Database "${dbId}" not found` });
      dbLabel = dbConfig.name || dbId;
      result = await executeQuery(project.id, dbConfig, sql);
    }

    // ★ 记录查询历史(落该项目 data/sql-history.json)
    historyAdd(project, {
      title, sql, dbId: dbId || connection?.database || 'direct', dbLabel, result, connection,
    });

    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 提交写操作
router.post('/api/sql/submit', requireProject, async (req: Request, res: Response) => {
  try {
    const project = reqProject(req);
    const { sql, reason, title, dbId, connection } = (req.body ?? {}) as SubmitSqlBody;

    // 校验
    if (!sql)       return res.status(400).json({ ok: false, error: 'sql is required' });
    if (!reason)    return res.status(400).json({ ok: false, error: 'reason is required — explain why this SQL is needed' });
    if (!title)     return res.status(400).json({ ok: false, error: 'title is required — give this operation a title' });
    if (!dbId && !connection) return res.status(400).json({ ok: false, error: 'dbId or connection is required' });

    // 拒绝 SELECT（应该用 /api/sql/query）
    if (isReadOnly(sql)) {
      return res.status(400).json({
        ok: false,
        error: 'Use POST /api/sql/query for SELECT queries. This endpoint is for write operations.',
      });
    }

    const reviewMode = getReviewMode();

    // 内联连接参数优先
    if (connection) {
      if (!reviewMode) {
        const result = await executeQueryDirect(connection, sql);
        const job = queueAdd(project, { sql, reason, dbId: connection.database || 'direct', title });
        queueUpdate(project, job.id, { status: 'executed', reviewedAt: Date.now(), result, connection });
        historyAdd(project, {
          title, sql, dbId: connection.database || 'direct', dbLabel: connection.database || 'direct', result, connection,
        });
        return res.json({ ok: true, id: job.id, status: 'executed', result, mode: 'silent' });
      }
      const job = queueAdd(project, { sql, reason, dbId: connection.database || 'direct', title });
      queueUpdate(project, job.id, { connection });
      return res.json({ ok: true, id: job.id, status: 'pending', mode: 'review' });
    }

    // 用预配置的 dbId(项目内)
    const dbConfig = sqlConnection(project, dbId!);
    if (!dbConfig) return res.status(404).json({ ok: false, error: `Database "${dbId}" not found` });

    const dbLabel = dbConfig.name || dbId!;

    if (!reviewMode) {
      const result = await executeQuery(project.id, dbConfig, sql);
      const job = queueAdd(project, { sql, reason, dbId: dbId!, title });
      queueUpdate(project, job.id, { status: 'executed', reviewedAt: Date.now(), result });
      historyAdd(project, { title, sql, dbId: dbId!, dbLabel, result });
      return res.json({ ok: true, id: job.id, status: 'executed', result, mode: 'silent' });
    }

    const job = queueAdd(project, { sql, reason, dbId: dbId!, title });
    res.json({ ok: true, id: job.id, status: 'pending', mode: 'review' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 轮询任务状态(项目内队列查)
router.get('/api/sql/status/:id', requireProject, (req: Request, res: Response) => {
  const project = reqProject(req);
  const job = queueGet(project, req.params.id);
  if (!job) {
    return res.status(404).json({ ok: false, error: `Job "${req.params.id}" not found` });
  }
  const { result, error, status, sql, reason, dbId, submittedAt, reviewedAt, rejectReason } = job;
  res.json({ id: job.id, status, sql, reason, dbId, submittedAt, reviewedAt, rejectReason, result, error });
});

export default router;
