// ── AI 查询历史记录 API(按项目作用域,落项目 data/sql-history.json) ──

import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import { historyList, historyGet } from '../projects/sql-store';
import { route } from '../utils/route-utils';

const router = Router();

// 获取历史列表（按时间倒序,最近 100 条）
router.get('/api/sql/history', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const list = historyList(project, 100);
  res.json({ ok: true, list });
}));

// 获取单条历史详情
router.get('/api/sql/history/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const entry = historyGet(project, String(req.params.id));
  if (!entry) return res.status(404).json({ ok: false, error: 'History entry not found' });
  res.json({ ok: true, entry });
}));

export default router;
