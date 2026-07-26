// ── SQL execution routes — query + submit + status ────────

import { Router, Request, Response } from 'express';
import { getDatabase, getReviewMode } from '../config-manager';
import { executeQuery, executeQueryDirect, isReadOnly } from '../db/connector';
import { addJob, getJob, updateJob } from '../sql-queue';
import { addHistory } from '../sql-history';
import type { SubmitSqlBody, QuerySqlBody } from '../types';

const router = Router();

/** 获取数据库显示标签 */
function getDbLabel(dbId: string): string {
  const db = getDatabase(dbId);
  return db?.name || dbId;
}

// 直接查询（SELECT 类）
router.post('/api/sql/query', async (req: Request, res: Response) => {
  try {
    const { sql, dbId, title, connection } = req.body as QuerySqlBody;
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
      const dbConfig = getDatabase(dbId);
      if (!dbConfig) return res.status(404).json({ ok: false, error: `Database "${dbId}" not found` });
      dbLabel = dbConfig.name || dbId;
      result = await executeQuery(dbConfig, sql);
    }

    // ★ 记录查询历史
    addHistory(title, sql, dbId || connection?.database || 'direct', dbLabel, result, connection);

    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 提交写操作
router.post('/api/sql/submit', async (req: Request, res: Response) => {
  try {
    const { sql, reason, title, dbId, connection } = req.body as SubmitSqlBody;

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

    // 内联连接参数优先
    if (connection) {
      const reviewMode = getReviewMode();
      if (!reviewMode) {
        const result = await executeQueryDirect(connection, sql);
        const job = addJob(sql, reason, connection.database || 'direct', title);
        updateJob(job.id, { status: 'executed', reviewedAt: Date.now(), result, connection });
        addHistory(title, sql, connection.database || 'direct', connection.database || 'direct', result, connection);
        return res.json({ ok: true, id: job.id, status: 'executed', result, mode: 'silent' });
      }
      const job = addJob(sql, reason, connection.database || 'direct', title);
      updateJob(job.id, { connection });
      return res.json({ ok: true, id: job.id, status: 'pending', mode: 'review' });
    }

    // 用预配置的 dbId
    const dbConfig = getDatabase(dbId!);
    if (!dbConfig) return res.status(404).json({ ok: false, error: `Database "${dbId}" not found` });

    const reviewMode = getReviewMode();
    const dbLabel = dbConfig.name || dbId!;

    if (!reviewMode) {
      const result = await executeQuery(dbConfig, sql);
      const job = addJob(sql, reason, dbId!, title);
      updateJob(job.id, { status: 'executed', reviewedAt: Date.now(), result });
      addHistory(title, sql, dbId!, dbLabel, result);
      return res.json({ ok: true, id: job.id, status: 'executed', result, mode: 'silent' });
    }

    const job = addJob(sql, reason, dbId!, title);
    res.json({ ok: true, id: job.id, status: 'pending', mode: 'review' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 轮询任务状态
router.get('/api/sql/status/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ ok: false, error: `Job "${req.params.id}" not found` });
  }
  const { result, error, status, sql, reason, dbId, submittedAt, reviewedAt, rejectReason } = job;
  res.json({ id: job.id, status, sql, reason, dbId, submittedAt, reviewedAt, rejectReason, result, error });
});

export default router;
