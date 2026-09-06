// ── Env routes: 环境变量组(项目 envs.yaml)→ 选用 → 全量重写全局 active-env.sh ──
//   存储:项目 <root>/.code-panel/envs.yaml(组定义,提交式)
//   记录:全局库 project_env(项目→当前组;source user/default)
//   兜底:项目没设过 → 自动用 default 组(见 env-store.ensureEnv)

import { Router, Request, Response } from 'express';
import type { ProjectRow } from '../db/global-store';
import { requireProject } from '../projects/context';
import {
  envSnapshot,
  ensureEnv,
  activateEnv,
  resetEnv,
  ensureShellRcMount,
} from '../env/env-store';

const router = Router();

function reqProject(req: Request): ProjectRow {
  return (req as Request & { project: ProjectRow }).project;
}

// GET /api/env?project=xxx — 组列表 + 当前生效组(只读)
router.get('/api/env', requireProject, (req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: envSnapshot(reqProject(req)) });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// POST /api/env/ensure — 打开项目时兜底:没设过 → 落到默认组并物化
router.post('/api/env/ensure', requireProject, (req: Request, res: Response) => {
  try {
    const project = reqProject(req);
    const result = ensureEnv(project);
    res.json({ ok: true, data: { changed: result.changed, current: result.current, snapshot: envSnapshot(project) } });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// POST /api/env/activate — 选用某组:body {groupId}
router.post('/api/env/activate', requireProject, (req: Request, res: Response) => {
  try {
    const { groupId } = req.body as { groupId?: unknown };
    if (typeof groupId !== 'string' || !groupId.trim()) {
      res.status(400).json({ ok: false, error: 'groupId 必填' });
      return;
    }
    const snap = activateEnv(reqProject(req), groupId.trim());
    res.json({ ok: true, data: snap });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// POST /api/env/reset — 清除手动设置 → 回落默认组
router.post('/api/env/reset', requireProject, (req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: resetEnv(reqProject(req)) });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// POST /api/env/mount — 手动补挂 ~/.zshrc(幂等;一般由选用自动做,这里提供显式入口)
router.post('/api/env/mount', requireProject, (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: ensureShellRcMount() });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
