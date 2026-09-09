// ── nginx routes(⚙ 配置 → nginx Tab)────────────────────────
//   只读:探测本机 nginx 状态 / 列项目 .code-panel/nginx conf / 读内容 / 检测加载与一致性。
//   端点(均需登录;除 /config 外 per-project ?project=<id>):
//     GET  /api/nginx/status?project=   → 本机 nginx 进程/版本/conf 目录
//     GET  /api/nginx/confs?project=    → 项目 .code-panel/nginx 下 .conf 列表
//     GET  /api/nginx/conf?project=&file= → 某 conf 内容
//     POST /api/nginx/check?project=&file= → nginx -t + server_name 是否加载 + md5 一致性
//     GET/PUT /api/nginx/config         → 全局 override(settings.nginx {bin,confPath})

import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import { route } from '../utils/route-utils';
import {
  resolveNginx, listProjectConfs, readProjectConf, checkProjectConf,
  nginxOverride, saveNginxOverride,
} from '../nginx/nginx-manager';

const router = Router();

// GET /api/nginx/status — 本机 nginx 状态(进程/版本/conf 目录/include 目录)
router.get('/api/nginx/status', requireProject, route((_req: Request, res: Response) => {
  res.json({ ok: true, data: resolveNginx() });
}));

// GET /api/nginx/confs — 项目 .code-panel/nginx 下 conf 列表
router.get('/api/nginx/confs', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  res.json({ ok: true, data: listProjectConfs(project) });
}));

// GET /api/nginx/conf — 读某 conf 内容(仅限项目 nginx 目录内)
router.get('/api/nginx/conf', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const file = typeof req.query.file === 'string' ? req.query.file : '';
  const read = readProjectConf(project, file);
  if (!read) return res.status(404).json({ ok: false, error: '文件不存在(仅支持项目 .code-panel/nginx 下 .conf)' });
  res.json({ ok: true, data: read });
}));

// POST /api/nginx/check — 语法 + 是否加载 + md5 一致性
router.post('/api/nginx/check', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const file = typeof req.body?.file === 'string' ? req.body.file : '';
  const result = checkProjectConf(project, file);
  if (!result) return res.status(404).json({ ok: false, error: '文件不存在(仅支持项目 .code-panel/nginx 下 .conf)' });
  res.json({ ok: true, data: result });
}));

// GET /api/nginx/config — 全局 override(settings.nginx)
router.get('/api/nginx/config', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: nginxOverride() });
}));

// PUT /api/nginx/config — 保存 override { bin?, confPath? }(空串清除)
router.put('/api/nginx/config', route((req: Request, res: Response) => {
  const b = (req.body ?? {}) as { bin?: unknown; confPath?: unknown };
  const saved = saveNginxOverride({ bin: typeof b.bin === 'string' ? b.bin : '', confPath: typeof b.confPath === 'string' ? b.confPath : '' });
  res.json({ ok: true, data: saved });
}));

export default router;
