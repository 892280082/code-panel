// ── Launch routes: 快捷启动链接 CRUD(随项目) ────────────────────

import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import { getAllLinks, addLink, deleteLink, updateLink, reorderLinks } from '../launch/launch-store';
import { route } from '../utils/route-utils';

const router = Router();

/** 补全链接协议:无 scheme 时默认 https,以 / 开头的相对路径原样保留 */
function normalizeUrl(url: string): string {
  const s = url.trim();
  if (s.startsWith('/')) return s;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  return 'https://' + s;
}

// GET /api/launch/links?project=xxx — 查询该项目的快捷启动链接
router.get('/api/launch/links', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const links = getAllLinks(project);
  res.json({ ok: true, data: links });
}));

// POST /api/launch/links — 新增快捷启动链接
router.post('/api/launch/links', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const { label, url, tag } = req.body;

  if (!label || typeof label !== 'string' || !label.trim() || label.trim().length > 100) {
    res.status(400).json({ ok: false, error: 'label is required and must be 1-100 characters' });
    return;
  }
  if (!url || typeof url !== 'string' || !url.trim() || url.trim().length > 2048) {
    res.status(400).json({ ok: false, error: 'url is required and must be 1-2048 characters' });
    return;
  }
  if (tag && (typeof tag !== 'string' || tag.trim().length > 50)) {
    res.status(400).json({ ok: false, error: 'tag must be at most 50 characters' });
    return;
  }

  const entry = addLink(project, label.trim(), normalizeUrl(url), tag && typeof tag === 'string' ? tag.trim() : undefined);

  res.status(201).json({ ok: true, data: entry });
}));

// PUT /api/launch/links/reorder — 重排该项目快捷启动链接
router.put('/api/launch/links/reorder', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some((id: any) => typeof id !== 'string')) {
    res.status(400).json({ ok: false, error: 'ids must be a string array' });
    return;
  }
  reorderLinks(project, ids);
  res.json({ ok: true });
}));

// PUT /api/launch/links/:id — 编辑快捷启动链接
router.put('/api/launch/links/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const id = String(req.params.id);
  const { label, url, tag } = req.body;

  if (label !== undefined && (typeof label !== 'string' || !label.trim() || label.trim().length > 100)) {
    res.status(400).json({ ok: false, error: 'label must be 1-100 characters' });
    return;
  }
  if (url !== undefined && (typeof url !== 'string' || !url.trim() || url.trim().length > 2048)) {
    res.status(400).json({ ok: false, error: 'url must be 1-2048 characters' });
    return;
  }
  if (tag !== undefined && (typeof tag !== 'string' || tag.trim().length > 50)) {
    res.status(400).json({ ok: false, error: 'tag must be at most 50 characters' });
    return;
  }

  const updated = updateLink(project, id, {
    label,
    url: url !== undefined ? normalizeUrl(url) : undefined,
    tag,
  });
  if (!updated) {
    res.status(404).json({ ok: false, error: 'link not found' });
    return;
  }
  res.json({ ok: true, data: updated });
}));

// DELETE /api/launch/links/:id — 删除快捷启动链接
router.delete('/api/launch/links/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const id = String(req.params.id);
  const deleted = deleteLink(project, id);
  if (!deleted) {
    res.status(404).json({ ok: false, error: 'link not found' });
    return;
  }
  res.json({ ok: true });
}));

export default router;
