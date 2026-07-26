// ── AI 查询历史记录 API ─────────────────────────────────

import { Router, Request, Response } from 'express';
import { getHistory, getHistoryEntry } from '../sql-history';

const router = Router();

// 获取历史列表（按时间倒序）
router.get('/api/sql/history', (_req: Request, res: Response) => {
  const list = getHistory(100);
  res.json({ ok: true, list });
});

// 获取单条历史详情
router.get('/api/sql/history/:id', (req: Request, res: Response) => {
  const entry = getHistoryEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'History entry not found' });
  res.json({ ok: true, entry });
});

export default router;
