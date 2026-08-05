// ── Launch routes: 快捷启动链接 CRUD ────────────────────

import { Router, Request, Response } from 'express';
import { getAllLinks, addLink, deleteLink, updateLink, reorderLinks } from '../launch/launch-store';

const router = Router();

/** 补全链接协议:无 scheme 时默认 https,以 / 开头的相对路径原样保留 */
function normalizeUrl(url: string): string {
  const s = url.trim();
  if (s.startsWith('/')) return s;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  return 'https://' + s;
}

// GET /api/launch/links?group=xxx — 查询快捷启动链接(按分组筛选)
router.get('/api/launch/links', (req: Request, res: Response) => {
  const group = req.query.group as string | undefined;
  const links = getAllLinks(group || undefined);
  res.json({ ok: true, data: links });
});

// POST /api/launch/links — 新增快捷启动链接
router.post('/api/launch/links', (req: Request, res: Response) => {
  const { label, url, tag, group } = req.body;

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

  const entry = addLink(
    label.trim(),
    normalizeUrl(url),
    group && typeof group === 'string' ? group.trim() : undefined,
    tag && typeof tag === 'string' ? tag.trim() : undefined
  );

  res.status(201).json({ ok: true, data: entry });
});

// PUT /api/launch/links/reorder — 重排快捷启动链接
router.put('/api/launch/links/reorder', (req: Request, res: Response) => {
  const { ids, group } = req.body;
  if (!Array.isArray(ids) || ids.some((id: any) => typeof id !== 'string')) {
    res.status(400).json({ ok: false, error: 'ids must be a string array' });
    return;
  }
  reorderLinks(ids, group || undefined);
  res.json({ ok: true });
});

// PUT /api/launch/links/:id — 编辑快捷启动链接
router.put('/api/launch/links/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { label, url, tag, group } = req.body;

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

  const updated = updateLink(id, {
    label,
    url: url !== undefined ? normalizeUrl(url) : undefined,
    tag,
    group,
  });
  if (!updated) {
    res.status(404).json({ ok: false, error: 'link not found' });
    return;
  }
  res.json({ ok: true, data: updated });
});

// DELETE /api/launch/links/:id — 删除快捷启动链接
router.delete('/api/launch/links/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = deleteLink(id);
  if (!deleted) {
    res.status(404).json({ ok: false, error: 'link not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
