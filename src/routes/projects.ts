// ── 项目路由:注册表 CRUD + 模块 YAML 读写 ──────────────

import { Router, Request, Response } from 'express';
import { errorMessage } from '../utils/route-utils';
import {
  allProjects, createProject, renameProject, removeProject,
  loadProjectModule, saveProjectModule,
} from '../projects/project-store';
import { getProject } from '../db/global-store';
import type { ModuleName, ModuleYaml } from '../projects/yaml';

const router = Router();
const MODULES: ModuleName[] = ['logs', 'sql', 'prd', 'git', 'commands', 'links'];

// GET /api/projects — 项目列表
router.get('/api/projects', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: allProjects() });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// POST /api/projects — 添加项目 {name, root}(ID 由系统整型自增)
router.post('/api/projects', (req: Request, res: Response) => {
  try {
    const { name, root } = (req.body ?? {}) as { name?: string; root?: string };
    if (!name || !root) return res.status(400).json({ ok: false, error: 'name 和 root 必填' });
    const project = createProject({ name, root });
    res.status(201).json({ ok: true, data: { project } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// PUT /api/projects/:id — 改 {name?, root?}
router.put('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    const { name, root } = (req.body ?? {}) as { name?: string; root?: string };
    const updated = renameProject(p.id, { name, root });
    res.json({ ok: true, data: { project: updated } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// DELETE /api/projects/:id — 删除注册(不删项目目录里的 .code-panel)
router.delete('/api/projects/:id', (req: Request, res: Response) => {
  try {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    removeProject(p.id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// GET /api/projects/:id/yaml/:module — 读某项目某模块 YAML
router.get('/api/projects/:id/yaml/:module', (req: Request, res: Response) => {
  try {
    const module = req.params.module as ModuleName;
    if (!MODULES.includes(module)) return res.status(400).json({ ok: false, error: `module 必须是 ${MODULES.join('/')}` });
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    res.json({ ok: true, data: { project: p.id, module, yaml: loadProjectModule(p, module) } });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// PUT /api/projects/:id/yaml/:module — 写(全量)某模块 YAML
router.put('/api/projects/:id/yaml/:module', (req: Request, res: Response) => {
  try {
    const module = req.params.module as ModuleName;
    if (!MODULES.includes(module)) return res.status(400).json({ ok: false, error: `module 必须是 ${MODULES.join('/')}` });
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    const value = (req.body?.yaml ?? req.body) as ModuleYaml;
    if (!value || typeof value !== 'object') return res.status(400).json({ ok: false, error: 'body 需为 yaml 对象(或 {yaml:对象})' });
    saveProjectModule(p, module, value);
    res.json({ ok: true, data: { project: p.id, module } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

export default router;
