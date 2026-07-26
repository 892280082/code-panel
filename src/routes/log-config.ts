// ── Log config CRUD routes ──────────────────────────────

import { Router, Request, Response } from 'express';
import {
  listGroups, getGroup, addGroup, updateGroup, deleteGroup,
  listEntries, addEntry, updateEntry, deleteEntry,
} from '../log-config-store';

const router = Router();

// ── Group ────────────────────────────────────────────────

// 列出所有分组（含日志条目）
router.get('/api/log-config', (_req: Request, res: Response) => {
  const groups = listGroups();
  const result = groups.map(g => ({
    key: g.groupKey,
    name: g.name,
    logs: listEntries(g.groupKey),
  }));
  res.json(result);
});

// 新增分组
router.post('/api/log-config', (req: Request, res: Response) => {
  try {
    const { key, name, logs } = req.body as { key: string; name: string; logs?: { name: string; file: string }[] };
    if (!key || !name) return res.status(400).json({ ok: false, error: 'key and name are required' });
    addGroup(key, name, logs);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// 修改分组名
router.put('/api/log-config/:key', (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name: string };
    if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
    updateGroup(req.params.key, name);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// 删除分组
router.delete('/api/log-config/:key', (req: Request, res: Response) => {
  try {
    deleteGroup(req.params.key);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// ── Log entries ──────────────────────────────────────────

// 给指定分组添加日志文件
router.post('/api/log-config/:key/logs', (req: Request, res: Response) => {
  try {
    const { name, file, port } = req.body as { name: string; file: string; port?: number };
    if (!name || !file) return res.status(400).json({ ok: false, error: 'name and file are required' });
    const result = addEntry(req.params.key, name, file, port);
    res.json({ ok: true, id: result.id });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// 修改日志条目
router.put('/api/log-config/:key/logs/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    const { name, file, port } = req.body as { name?: string; file?: string; port?: number | null };
    updateEntry(id, { name, file, port });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// 删除日志条目
router.delete('/api/log-config/:key/logs/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
    deleteEntry(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
