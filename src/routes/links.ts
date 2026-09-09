// ── Quick Links routes: 读取项目 .code-panel/links.yaml 的分组快捷方式 ──
//   纯展示 + 打开:数据提交式随仓库走、手写 yaml,故无 per-link CRUD;
//   如需改/加,直接用通用 /api/projects/:id/yaml/links PUT 全量写即可。

import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import { loadProjectModule } from '../projects/project-store';
import type { LinksModuleYaml } from '../projects/yaml';
import { route } from '../utils/route-utils';

const router = Router();

// GET /api/links?project=xxx — 查询该项目快捷方式分组结构
router.get('/api/links', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const yaml = loadProjectModule(project, 'links') as LinksModuleYaml;
  res.json({ ok: true, data: yaml.groups || [] });
}));

export default router;
