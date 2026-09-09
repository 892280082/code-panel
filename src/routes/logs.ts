// ── Log viewing routes(全部按 ?project=/X-Project-Id 作用域) ──

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { addClient, removeClient, getLogs, readFileContent, clearFileState } from '../log-monitor';
import { requireProject, reqProject } from '../projects/context';
import { isProjectLogFile } from '../projects/adapters';
import { route } from '../utils/route-utils';

const router = Router();

/** 取中间件挂好的 project */
// SSE 实时推送(?project=<id> 必填;按项目过滤)
router.get('/api/stream', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  addClient(res, project.id);
  req.on('close', () => removeClient(res));
}));

// 日志列表(保持 apps.yaml 书写顺序,仅该项目的 apps.yaml/logs.yaml)
router.get('/api/logs', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  res.json({ ok: true, data: getLogs(project) });
}));

// 获取日志内容(file 必须是该项目的日志)
router.get('/api/log/content', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const fp = typeof req.query.file === 'string' ? req.query.file : '';
  if (!fp) return res.status(400).json({ ok: false, error: 'missing file' });
  if (!isProjectLogFile(project, fp)) {
    return res.status(403).json({ ok: false, error: 'file 不属于该项目的日志清单' });
  }
  const result = readFileContent(fp);
  res.json({ ok: true, data: result });
}));

// 清空日志文件（truncate，类似 : > file;file 必须是该项目的日志）
router.post('/api/log/clear', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const fp = typeof req.body?.file === 'string' ? req.body.file : '';
  if (!fp) return res.status(400).json({ ok: false, error: 'missing file' });
  if (!isProjectLogFile(project, fp)) {
    return res.status(403).json({ ok: false, error: 'file 不属于该项目的日志清单' });
  }
  try {
    fs.writeFileSync(fp, '', 'utf8');
    // 重置文件状态缓存，下次 poll 会重新从头读取
    clearFileState(fp);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}));

export default router;
