// ── SQL execution routes — query + submit + status ────────

import { Router, Request, Response } from 'express';
import { getDatabase, getReviewMode } from '../config-manager';
import { executeQuery, isReadOnly } from '../db/connector';
import { addJob, getJob, updateJob } from '../sql-queue';
import type { SubmitSqlBody } from '../types';

const router = Router();

// 直接查询（SELECT 类）
router.post('/api/sql/query', async (req: Request, res: Response) => {
  try {
    const { sql, dbId } = req.body as { sql: string; dbId: string };
    if (!sql || !dbId) {
      return res.status(400).json({ ok: false, error: 'sql and dbId are required' });
    }

    const dbConfig = getDatabase(dbId);
    if (!dbConfig) {
      return res.status(404).json({ ok: false, error: `Database "${dbId}" not found` });
    }

    if (!isReadOnly(sql)) {
      return res.status(400).json({
        ok: false,
        error: 'Use POST /api/sql/submit for write operations (INSERT/UPDATE/DELETE). This endpoint only accepts SELECT.',
      });
    }

    const result = await executeQuery(dbConfig, sql);
    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 提交写操作
router.post('/api/sql/submit', async (req: Request, res: Response) => {
  try {
    const { sql, reason, dbId } = req.body as SubmitSqlBody;

    // 校验
    if (!sql)       return res.status(400).json({ ok: false, error: 'sql is required' });
    if (!reason)    return res.status(400).json({ ok: false, error: 'reason is required — explain why this SQL is needed' });
    if (!dbId)      return res.status(400).json({ ok: false, error: 'dbId is required' });

    const dbConfig = getDatabase(dbId);
    if (!dbConfig) {
      return res.status(404).json({ ok: false, error: `Database "${dbId}" not found` });
    }

    // 拒绝 SELECT（应该用 /api/sql/query）
    if (isReadOnly(sql)) {
      return res.status(400).json({
        ok: false,
        error: 'Use POST /api/sql/query for SELECT queries. This endpoint is for write operations.',
      });
    }

    const reviewMode = getReviewMode();

    // ★ 静默模式：直接执行，不进队列
    if (!reviewMode) {
      const result = await executeQuery(dbConfig, sql);
      const job = addJob(sql, reason, dbId);
      updateJob(job.id, { status: 'executed', reviewedAt: Date.now(), result });
      return res.json({ ok: true, id: job.id, status: 'executed', result, mode: 'silent' });
    }

    // ★ 评审模式：入队等待审批
    const job = addJob(sql, reason, dbId);
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
