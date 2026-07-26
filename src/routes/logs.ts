// ── Log viewing routes ──────────────────────────────────

import { Router, Request, Response } from 'express';
import { addClient, removeClient, getLogsSorted, readFileContent } from '../log-monitor';

const router = Router();

// SSE 实时推送
router.get('/api/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  addClient(res);
  req.on('close', () => removeClient(res));
});

// 日志列表（按 alive + active 排序）
router.get('/api/logs', async (_req: Request, res: Response) => {
  res.json(await getLogsSorted());
});

// 获取日志内容
router.get('/api/log/content', (req: Request, res: Response) => {
  const fp = typeof req.query.file === 'string' ? req.query.file : '';
  if (!fp) return res.status(400).json({ error: 'missing file' });
  const result = readFileContent(fp);
  res.json(result);
});

export default router;
