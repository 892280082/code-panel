// ── Log viewing routes ──────────────────────────────────

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { addClient, removeClient, getLogsSorted, readFileContent, clearFileState } from '../log-monitor';

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

// 日志列表（按名称排序）
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

// 清空日志文件（truncate，类似 : > file）
router.post('/api/log/clear', (req: Request, res: Response) => {
  const fp = typeof req.body.file === 'string' ? req.body.file : '';
  if (!fp) return res.status(400).json({ error: 'missing file' });
  try {
    fs.writeFileSync(fp, '', 'utf8');
    // 重置文件状态缓存，下次 poll 会重新从头读取
    clearFileState(fp);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
