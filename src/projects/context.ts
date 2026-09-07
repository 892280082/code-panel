// ── 请求级「当前项目」解析与校验 ──────────────────────
//   所有项目级接口统一通过 ?project=<id> 或 X-Project-Id 头携带。
//   多账号:非超管仅可访问被分配的项目(user_projects 表),否则 403。

import type { Request, Response, NextFunction } from 'express';
import { getProject, listUserProjectIds, type ProjectRow } from '../db/global-store';
import { reqUser } from '../auth/jwt';

export function projectIdFromRequest(req: Request): string | undefined {
  const q = typeof req.query.project === 'string' ? req.query.project : undefined;
  if (q && q.trim()) return q.trim();
  const h = req.header('x-project-id');
  if (h && h.trim()) return h.trim();
  // 兜底:部分 POST 把 project 放 body(如 PRD done)
  const b = (req.body as { project?: unknown } | undefined)?.project;
  if (typeof b === 'string' && b.trim()) return b.trim();
  return undefined;
}

/** 当前用户是否有权访问该项目(超管全通过;普通用户查分配表) */
export function canAccessProject(req: Request, projectId: string): boolean {
  const u = reqUser(req);
  if (!u) return false;
  if (u.role === 'superadmin') return true;
  return listUserProjectIds(u.username).includes(projectId);
}

/** 解析并校验项目;返回 null 表示参数缺失/非法(已由调用方决定是否 400) */
export function resolveProject(req: Request): { project?: ProjectRow; error?: string } {
  const id = projectIdFromRequest(req);
  if (!id) return { error: '缺少项目参数:请携带 ?project=<id>' };
  const p = getProject(id);
  if (!p) return { error: `未知项目: ${id}` };
  if (!canAccessProject(req, id)) return { error: '无该项目权限' };
  return { project: p };
}

/** 中间件:未带/无效项目时 400,无权限时 403 */
export function requireProject(req: Request, res: Response, next: NextFunction): void {
  const { project, error } = resolveProject(req);
  if (!project || error) {
    const denied = error === '无该项目权限';
    res.status(denied ? 403 : 400).json({ ok: false, error: error || '项目不存在' });
    return;
  }
  (req as Request & { project: ProjectRow }).project = project;
  next();
}
