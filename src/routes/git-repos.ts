// ── Git repo config routes(按项目 git.yaml 作用域;repo id 为 string) ──

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import {
  listRepos, getRepo, addRepo, updateRepo, deleteRepo,
} from '../git/git-repo-store';
import { getDiff, getSummary } from '../git/git-diff';
import { pullRepo, getCommitLog } from '../git/git-pull';
import { route, errorMessage } from '../utils/route-utils';
import { safeResolve } from '../utils/safe-resolve';

const router = Router();

// ── Repo CRUD ────────────────────────────────────────────

// 列出该项目的 git.yaml 仓库
router.get('/api/git/repos', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  res.json({ ok: true, data: listRepos(project) });
}));

// 新增仓库:body { id?, name, path|repoPath, notes? }
router.post('/api/git/repos', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const body = (req.body ?? {}) as { id?: string; name?: string; path?: string; repoPath?: string; notes?: string };
  const name = body.name ?? '';
  const repoPath = body.path ?? body.repoPath ?? '';
  if (!name || !repoPath) return res.status(400).json({ ok: false, error: 'name and path are required' });
  // 支持调用方显式给 string id;缺省由 store 按 name 生成 slug
  const repo = addRepo(project, name, repoPath, body.notes, body.id);
  res.json({ ok: true, repo });
}));

// 修改仓库
router.put('/api/git/repos/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const id = String(req.params.id);
  if (!getRepo(project, id)) return res.status(404).json({ ok: false, error: `Repo ${id} not found` });
  const body = (req.body ?? {}) as { name?: string; path?: string; repoPath?: string; notes?: string };
  const repo = updateRepo(project, id, {
    name: body.name,
    path: body.path ?? body.repoPath,
    notes: body.notes,
  });
  res.json({ ok: true, repo });
}));

// 删除仓库
router.delete('/api/git/repos/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const deleted = deleteRepo(project, String(req.params.id));
  if (!deleted) return res.status(404).json({ ok: false, error: `Repo ${req.params.id} not found` });
  res.json({ ok: true });
}));

// ── Source file ────────────────────────────────────────────

router.get('/api/git/source/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const repo = getRepo(project, String(req.params.id));
  if (!repo) return res.status(404).json({ ok: false, error: `Repo ${req.params.id} not found` });
  const file = req.query.file as string;
  if (!file) return res.status(400).json({ ok: false, error: 'file query param required' });
  let fullPath: string;
  try {
    fullPath = safeResolve(repo.path, file); // 带分隔符边界,字符串前缀检查会被 ../repoX 绕过
  } catch {
    return res.status(403).json({ ok: false, error: 'Path traversal denied' });
  }
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ ok: false, error: `File not found: ${file}` });
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const stat = fs.statSync(fullPath);
  res.json({ ok: true, path: file, size: stat.size, content });
}));

// ── Diff ─────────────────────────────────────────────────

router.get('/api/git/diff/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const repo = getRepo(project, String(req.params.id));
  if (!repo) return res.status(404).json({ ok: false, error: `Repo ${req.params.id} not found` });
  const staged = req.query.staged === 'true';
  const result = getDiff(repo.id, repo.name, repo.path, staged);
  res.json({ ok: true, ...result });
}));

// ── Summary ───────────────────────────────────────────────

router.get('/api/git/summary/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const repo = getRepo(project, String(req.params.id));
  if (!repo) return res.status(404).json({ ok: false, error: `Repo ${req.params.id} not found` });
  const staged = req.query.staged === 'true';
  res.json({ ok: true, ...getSummary(repo.id, repo.name, repo.path, staged) });
}));

// ── Pull All(该项目的全部仓库) ────────────────────────────

router.post('/api/git/pull-all', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const repos = listRepos(project);
  if (!repos.length) {
    return res.json({ ok: true, results: [], message: 'No repos to pull' });
  }
  const results = repos.map(r => pullRepo(r.id, r.name, r.path));
  res.json({ ok: true, results });
}));

// ── Commit Log ────────────────────────────────────────────

router.get('/api/git/log/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const repo = getRepo(project, String(req.params.id));
  if (!repo) return res.status(404).json({ ok: false, error: `Repo ${req.params.id} not found` });
  const limit = parseInt((req.query.limit as string) || '100');
  const offset = parseInt((req.query.offset as string) || '0');
  const log = getCommitLog(repo.id, repo.name, repo.path, limit, offset);
  res.json({ ok: true, ...log });
}));

export default router;
