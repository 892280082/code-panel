// ── Config routes(仅全局设置;groups/databases 已随项目下沉) ──

import { Router, Request, Response } from 'express';
import { getGlobalSettings, setReviewMode } from '../config-manager';

const router = Router();

// 获取全局设置(reviewMode + ttyd + terminalDefaultCwd + jwt)
router.get('/api/config', (_req: Request, res: Response) => {
  res.json(getGlobalSettings());
});

// 保存:仅更新 reviewMode(全局)
router.put('/api/config', (req: Request, res: Response) => {
  try {
    const reviewMode = (req.body as { reviewMode?: unknown })?.reviewMode;
    if (typeof reviewMode === 'boolean') setReviewMode(reviewMode);
    res.json({ ok: true, reviewMode: getGlobalSettings().reviewMode });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg });
  }
});

export default router;
