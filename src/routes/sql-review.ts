// ── SQL review panel routes ──────────────────────────────

import { Router, Request, Response } from 'express';
import { getJobs, updateJob, getJob } from '../sql-queue';
import { getDatabase, getReviewMode, setReviewMode } from '../config-manager';
import { executeQuery } from '../db/connector';
import { REVIEW_TOKEN, checkToken } from '../auth-token';
import type { SqlJobStatus } from '../types';

const router = Router();

// 获取任务队列（支持 ?status=pending 筛选）
router.get('/api/sql/queue', (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status as SqlJobStatus : undefined;
  const jobs = getJobs(status);
  res.json({ ok: true, jobs, reviewMode: getReviewMode() });
});

// 批准 → 执行 SQL（需令牌）
router.post('/api/sql/approve/:id', async (req: Request, res: Response) => {
  if (!checkToken(req.body?.token)) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing token' });
  }
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${req.params.id}" not found` });
  if (job.status !== 'pending') return res.status(400).json({ ok: false, error: `Job is ${job.status}, not pending` });

  const dbConfig = getDatabase(job.dbId);
  if (!dbConfig) {
    updateJob(job.id, { status: 'failed', reviewedAt: Date.now(), error: `Database "${job.dbId}" not found` });
    return res.status(404).json({ ok: false, error: `Database "${job.dbId}" not found` });
  }

  try {
    const result = await executeQuery(dbConfig, job.sql);
    updateJob(job.id, { status: 'executed', reviewedAt: Date.now(), result });
    res.json({ ok: true, id: job.id, status: 'executed', result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    updateJob(job.id, { status: 'failed', reviewedAt: Date.now(), error: msg });
    res.json({ ok: false, id: job.id, status: 'failed', error: msg });
  }
});

// 拒绝（需令牌）
router.post('/api/sql/reject/:id', (req: Request, res: Response) => {
  if (!checkToken(req.body?.token)) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing token' });
  }
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: `Job "${req.params.id}" not found` });
  if (job.status !== 'pending') return res.status(400).json({ ok: false, error: `Job is ${job.status}, not pending` });

  const { reason } = req.body as { reason?: string };
  updateJob(job.id, { status: 'rejected', reviewedAt: Date.now(), rejectReason: reason });
  res.json({ ok: true, id: job.id, status: 'rejected' });
});

// 查看评审模式（含令牌，供页面读取）
router.get('/api/sql/review-mode', (_req: Request, res: Response) => {
  res.json({ reviewMode: getReviewMode(), token: REVIEW_TOKEN });
});

// 切换评审模式（需令牌）
router.post('/api/sql/review-mode', (req: Request, res: Response) => {
  if (!checkToken(req.body?.token)) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing token' });
  }
  const { enabled } = req.body as { enabled: boolean };
  const cfg = setReviewMode(!!enabled);
  res.json({ ok: true, reviewMode: cfg.reviewMode });
});

export default router;
