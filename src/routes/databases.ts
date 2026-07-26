// ── Database connection management routes ────────────────

import { Router, Request, Response } from 'express';
import { getDatabasesSafe } from '../config-manager';
import { testConnection } from '../db/connector';
import { getHealthStatus, checkAllDatabases } from '../db/health-check';
import { listConnectionsSafe, addConnection, updateConnection, deleteConnection } from '../db/db-config-store';
import type { DbConnection } from '../types';

const router = Router();

// 列出所有数据库（含存活状态）
router.get('/api/db', (_req: Request, res: Response) => {
  const dbs = getDatabasesSafe();
  const list = dbs.map(db => {
    const health = getHealthStatus(db.id);
    return {
      ...db,
      alive: health?.alive ?? false,
      lastCheck: health?.lastCheck ?? null,
      serverVersion: health?.serverVersion ?? null,
      healthError: health?.error ?? null,
    };
  });
  res.json(list);
});

// 新增数据库
router.post('/api/db', (req: Request, res: Response) => {
  try {
    const db = req.body as DbConnection;
    if (!db.id || !db.name || !db.type) {
      return res.status(400).json({ ok: false, error: 'id, name, type are required' });
    }
    addConnection(db);
    res.json({ ok: true, databases: listConnectionsSafe() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg });
  }
});

// 修改数据库连接
router.put('/api/db/:id', (req: Request, res: Response) => {
  try {
    updateConnection(req.params.id, req.body);
    res.json({ ok: true, databases: listConnectionsSafe() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg });
  }
});

// 删除数据库
router.delete('/api/db/:id', (req: Request, res: Response) => {
  try {
    deleteConnection(req.params.id);
    res.json({ ok: true, databases: listConnectionsSafe() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg });
  }
});

// 测试连接（不更新缓存）
router.post('/api/db/test', async (req: Request, res: Response) => {
  const result = await testConnection(req.body as DbConnection);
  res.json(result);
});

// ★ 手动刷新所有数据库连接状态
router.post('/api/db/refresh', async (_req: Request, res: Response) => {
  const t0 = Date.now();
  await checkAllDatabases();
  const elapsed = Date.now() - t0;

  // 返回最新状态
  const dbs = getDatabasesSafe();
  const list = dbs.map(db => {
    const health = getHealthStatus(db.id);
    return {
      id: db.id,
      name: db.name,
      alive: health?.alive ?? false,
      serverVersion: health?.serverVersion ?? null,
      healthError: health?.error ?? null,
      lastCheck: health?.lastCheck ?? null,
    };
  });

  res.json({ ok: true, elapsed, databases: list });
});

export default router;
