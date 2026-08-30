// ── Git repo config routes ───────────────────────────────

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import {
  listRepos, getRepo, addRepo, updateRepo, deleteRepo,
} from '../git/git-repo-store';
import { getDiff, getSummary } from '../git/git-diff';
import { pullRepo, getCommitLog } from '../git/git-pull';
import { errorMessage } from '../utils/route-utils';

const router = Router();

// ── Repo CRUD ────────────────────────────────────────────

router.get('/api/git/repos', (req: Request, res: Response) => {
  try {
    const group = req.query.group as string;
    res.json(listRepos(group || undefined));
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

router.post('/api/git/repos', (req: Request, res: Response) => {
  try {
    const { name, repoPath, notes, group } = req.body as { name: string; repoPath: string; notes?: string; group?: string };
    if (!name || !repoPath) return res.status(400).json({ ok: false, error: 'name and repoPath are required' });
    const repo = addRepo(name, repoPath, notes, group);
    res.json({ ok: true, repo });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

router.put('/api/git/repos/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    updateRepo(id, req.body);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

router.delete('/api/git/repos/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    deleteRepo(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// ── Source file ────────────────────────────────────────────

router.get('/api/git/source/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    const repo = getRepo(id);
    if (!repo) return res.status(404).json({ ok: false, error: `Repo ${id} not found` });
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ ok: false, error: 'file query param required' });
    const fullPath = path.join(repo.path, file);
    if (!fullPath.startsWith(repo.path)) {
      return res.status(403).json({ ok: false, error: 'Path traversal denied' });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ ok: false, error: `File not found: ${file}` });
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    const stat = fs.statSync(fullPath);
    res.json({ ok: true, path: file, size: stat.size, content });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// ── Diff ─────────────────────────────────────────────────

router.get('/api/git/diff/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    const repo = getRepo(id);
    if (!repo) return res.status(404).json({ ok: false, error: `Repo ${id} not found` });
    const staged = req.query.staged === 'true';
    const result = getDiff(repo.id, repo.name, repo.path, staged);
    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// ── Summary ───────────────────────────────────────────────

router.get('/api/git/summary/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    const repo = getRepo(id);
    if (!repo) return res.status(404).json({ ok: false, error: `Repo ${id} not found` });
    const staged = req.query.staged === 'true';
    res.json(getSummary(repo.id, repo.name, repo.path, staged));
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// ── Pull All ──────────────────────────────────────────────

router.post('/api/git/pull-all', (req: Request, res: Response) => {
  try {
    const group = req.query.group as string;
    const repos = listRepos(group || undefined);
    if (!repos.length) {
      return res.json({ ok: true, results: [], message: 'No repos to pull' });
    }
    const results = repos.map(r => pullRepo(r.id, r.name, r.path));
    res.json({ ok: true, results });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

// ── Commit Log ────────────────────────────────────────────

router.get('/api/git/log/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    const repo = getRepo(id);
    if (!repo) return res.status(404).json({ ok: false, error: `Repo ${id} not found` });
    const limit = parseInt((req.query.limit as string) || '100');
    const offset = parseInt((req.query.offset as string) || '0');
    const log = getCommitLog(repo.id, repo.name, repo.path, limit, offset);
    res.json({ ok: true, ...log });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

export default router;
