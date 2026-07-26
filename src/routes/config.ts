// ── Config routes ────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { loadConfig, saveConfig } from '../config-manager';

const router = Router();

// 获取完整配置
router.get('/api/config', (_req: Request, res: Response) => {
  res.json(loadConfig());
});

// 保存配置
router.put('/api/config', (req: Request, res: Response) => {
  try {
    saveConfig(req.body);
    res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg });
  }
});

export default router;
