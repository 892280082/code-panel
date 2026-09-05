// ── AI 查询历史记录 API(按项目作用域,落项目 data/sql-history.json) ──

import { Router, Request, Response } from 'express';
import type { ProjectRow } from '../db/global-store';
import { requireProject } from '../projects/context';
import { historyList, historyGet } from '../projects/sql-store';

const router = Router();

function reqProject(req: Request): ProjectRow {
  return (req as Request & { project: ProjectRow }).project;
}

// 获取历史列表（按时间倒序,最近 100 条）
router.get('/api/sql/history', requireProject, (req: Request, res: Response) => {
  const project = reqProject(req);
  const list = historyList(project, 100);
  res.json({ ok: true, list });
});

// 获取单条历史详情
router.get('/api/sql/history/:id', requireProject, (req: Request, res: Response) => {
  const project = reqProject(req);
  const entry = historyGet(project, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'History entry not found' });
  res.json({ ok: true, entry });
});

export default router;
