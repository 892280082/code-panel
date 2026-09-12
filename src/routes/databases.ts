// ── Database connection management routes(按项目 sql.yaml 作用域) ──

import { Router, Request, Response } from 'express';
import type { ProjectRow } from '../db/global-store';
import { requireProject, reqProject } from '../projects/context';
import { sqlConnections, sqlConnection, sqlConnectionRaw, upsertProjectList, deleteProjectListItem } from '../projects/adapters';
import { testConnection, invalidateConnection } from '../db/connector';
import { getHealthStatus, checkProjectDatabases } from '../db/health-check';
import type { DbConnection } from '../types';
import { route, errorMessage } from '../utils/route-utils';

const router = Router();

/** 去密码后的连接列表(带 health 状态,供前端展示) */
function safeList(project: ProjectRow): Array<Omit<DbConnection, 'password'> & {
  hasPassword: boolean; alive: boolean; lastCheck: number | null;
  serverVersion: string | null; healthError: string | null;
}> {
  return sqlConnections(project).map(c => {
    const { password, ...rest } = c;
    const health = getHealthStatus(project.id, c.id);
    return {
      ...rest,
      hasPassword: !!password,
      alive: health?.alive ?? false,
      lastCheck: health?.lastCheck ?? null,
      serverVersion: health?.serverVersion ?? null,
      healthError: health?.error ?? null,
    };
  });
}

// 列出该项目所有数据库连接(含存活状态)
router.get('/api/db', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  res.json({ ok: true, data: safeList(project) });
}));

// 新增数据库连接(POST /api/db,body 即 DbConnection;id 重复则 400)
router.post('/api/db', requireProject, route((req: Request, res: Response) => {
  try {
    const project = reqProject(req);
    const db = (req.body ?? {}) as DbConnection;
    if (!db.id || !db.name || !db.type) {
      return res.status(400).json({ ok: false, error: 'id, name, type are required' });
    }
    if (sqlConnection(project, db.id)) {
      return res.status(400).json({ ok: false, error: `Database "${db.id}" already exists` });
    }
    upsertProjectList<DbConnection>(project, 'sql', 'id', db.id, db);
    invalidateConnection(project.id, db.id);
    res.json({ ok: true, data: safeList(project) });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    res.status(400).json({ ok: false, error: msg });
  }
}));

// 修改数据库连接(PUT /api/db/:id;body 为要合并的字段)
router.put('/api/db/:id', requireProject, route((req: Request, res: Response) => {
  try {
    const project = reqProject(req);
    const id = String(req.params.id);
    const existing = sqlConnectionRaw(project, id);   // 原始未插值:合并写盘不固化占位符
    if (!existing) return res.status(404).json({ ok: false, error: `Database "${id}" not found` });
    upsertProjectList<DbConnection>(project, 'sql', 'id', id, { ...existing, ...(req.body ?? {}) } as DbConnection);
    invalidateConnection(project.id, id);
    res.json({ ok: true, data: safeList(project) });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    res.status(400).json({ ok: false, error: msg });
  }
}));

// 删除数据库连接
router.delete('/api/db/:id', requireProject, route((req: Request, res: Response) => {
  try {
    const project = reqProject(req);
    const id = String(req.params.id);
    const deleted = deleteProjectListItem(project, 'sql', 'id', id);
    if (!deleted) return res.status(404).json({ ok: false, error: `Database "${id}" not found` });
    invalidateConnection(project.id, id);
    res.json({ ok: true, data: safeList(project) });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    res.status(400).json({ ok: false, error: msg });
  }
}));

// 测试连接(内联参数直连,不需 project,不更新缓存)
router.post('/api/db/test', route(async (req: Request, res: Response) => {
  const result = await testConnection(req.body as DbConnection);
  res.json(Object.assign({ ok: true }, result));   // Object.assign:保留 result 里自带 ok 的运行时覆盖语义
}));

// 手动刷新该项目所有连接状态
router.post('/api/db/refresh', requireProject, route(async (req: Request, res: Response) => {
  const project = reqProject(req);
  const t0 = Date.now();
  await checkProjectDatabases(project);
  const elapsed = Date.now() - t0;
  res.json({ ok: true, elapsed, data: safeList(project) });
}));

export default router;
