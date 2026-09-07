// ── 项目路由:注册表 CRUD + 模块 YAML 读写 ──────────────

import { Router, Request, Response } from 'express';
import { errorMessage } from '../utils/route-utils';
import {
  createProject, renameProject, removeProject,
  loadProjectModule, saveProjectModule,
} from '../projects/project-store';
import { getProject, listProjectsForUser } from '../db/global-store';
import { reqUser, requireSuperadmin } from '../auth/jwt';
import { canAccessProject } from '../projects/context';
import type { ModuleName, ModuleYaml } from '../projects/yaml';

const router = Router();
const MODULES: ModuleName[] = ['logs', 'sql', 'prd', 'git', 'commands', 'links'];

// GET /api/projects — 项目列表(超管=全部;普通用户=仅被分配的)
router.get('/api/projects', (req: Request, res: Response) => {
  try {
    const username = reqUser(req)?.username;
    res.json({ ok: true, data: username ? listProjectsForUser(username) : [] });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// POST /api/projects — 添加项目 {name, root, note?}(ID 由系统整型自增)——超管专属
router.post('/api/projects', requireSuperadmin, (req: Request, res: Response) => {
  try {
    const { name, root, note } = (req.body ?? {}) as { name?: string; root?: string; note?: string };
    if (!name || !root) return res.status(400).json({ ok: false, error: 'name 和 root 必填' });
    const project = createProject({ name, root, note });
    res.status(201).json({ ok: true, data: { project } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// PUT /api/projects/:id — 改 {name?, root?, note?} —— 超管专属(全局注册表)
router.put('/api/projects/:id', requireSuperadmin, (req: Request, res: Response) => {
  try {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    const { name, root, note } = (req.body ?? {}) as { name?: string; root?: string; note?: string };
    const updated = renameProject(p.id, { name, root, note });
    res.json({ ok: true, data: { project: updated } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// DELETE /api/projects/:id — 删除注册(不删项目目录里的 .code-panel)—— 超管专属
router.delete('/api/projects/:id', requireSuperadmin, (req: Request, res: Response) => {
  try {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    removeProject(p.id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// GET /api/projects/:id/yaml/:module — 读某项目某模块 YAML(跟随项目归属)
router.get('/api/projects/:id/yaml/:module', (req: Request, res: Response) => {
  try {
    const module = req.params.module as ModuleName;
    if (!MODULES.includes(module)) return res.status(400).json({ ok: false, error: `module 必须是 ${MODULES.join('/')}` });
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    if (!canAccessProject(req, p.id)) return res.status(403).json({ ok: false, error: '无该项目权限' });
    res.json({ ok: true, data: { project: p.id, module, yaml: loadProjectModule(p, module) } });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// PUT /api/projects/:id/yaml/:module — 写(全量)某模块 YAML(跟随项目归属)
router.put('/api/projects/:id/yaml/:module', (req: Request, res: Response) => {
  try {
    const module = req.params.module as ModuleName;
    if (!MODULES.includes(module)) return res.status(400).json({ ok: false, error: `module 必须是 ${MODULES.join('/')}` });
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: `项目 ${req.params.id} 不存在` });
    if (!canAccessProject(req, p.id)) return res.status(403).json({ ok: false, error: '无该项目权限' });
    const value = (req.body?.yaml ?? req.body) as ModuleYaml;
    if (!value || typeof value !== 'object') return res.status(400).json({ ok: false, error: 'body 需为 yaml 对象(或 {yaml:对象})' });
    saveProjectModule(p, module, value);
    res.json({ ok: true, data: { project: p.id, module } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

export default router;
