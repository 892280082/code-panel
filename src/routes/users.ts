// ── 用户管理路由(全部超管专属)──────────────────────────
//   多账号:创建账号 / 重置密码 / 分配项目 / 删除账号。
//   普通用户仅项目可见性被隔离,其余功能照常(信任模型)。

import { Router, Request, Response } from 'express';
import { errorMessage } from '../utils/route-utils';
import { requireSuperadmin, reqUser } from '../auth/jwt';
import {
  addUser, deleteUser, findUser, updatePassword,
  listUsersSafe, listUserProjectIds, setUserProjects, listProjects,
} from '../db/global-store';

const router = Router();

interface UserView {
  username: string;
  role: string;
  createdAt: number;
  /** 分配的项目 id 列表(超管返回全部项目 id,便于前端统一展示勾选态) */
  projectIds: string[];
}

function userViews(): UserView[] {
  const allIds = listProjects().map(p => p.id);
  return listUsersSafe().map(u => ({
    username: u.username,
    role: u.role,
    createdAt: u.created_at,
    projectIds: u.role === 'superadmin' ? allIds : listUserProjectIds(u.username),
  }));
}

// GET /api/users — 用户列表(含分配情况)
router.get('/api/users', requireSuperadmin, (_req: Request, res: Response) => {
  res.json({ ok: true, data: { users: userViews() } });
});

// POST /api/users — 创建账号 {username, password, projectIds?}
router.post('/api/users', requireSuperadmin, (req: Request, res: Response) => {
  try {
    const { username, password, projectIds } = (req.body ?? {}) as {
      username?: string; password?: string; projectIds?: unknown;
    };
    const name = (username ?? '').trim();
    if (!name) return res.status(400).json({ ok: false, error: '用户名必填' });
    if (!/^[A-Za-z0-9_-]{2,32}$/.test(name)) {
      return res.status(400).json({ ok: false, error: '用户名仅限字母/数字/-/_,2~32 位' });
    }
    if (typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ ok: false, error: '初始密码至少 4 位' });
    }
    if (findUser(name)) return res.status(409).json({ ok: false, error: `用户 ${name} 已存在` });

    const ids = Array.isArray(projectIds) ? projectIds.filter((v): v is string => typeof v === 'string') : [];
    addUser(name, password, 'user');
    if (ids.length) setUserProjects(name, ids);
    res.status(201).json({ ok: true, data: { users: userViews() } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// PUT /api/users/:username — 重置密码 / 重分配项目 {password? | projectIds?}
router.put('/api/users/:username', requireSuperadmin, (req: Request, res: Response) => {
  try {
    const name = String(req.params.username || '');
    if (!findUser(name)) return res.status(404).json({ ok: false, error: `用户 ${name} 不存在` });

    const { password, projectIds } = (req.body ?? {}) as { password?: unknown; projectIds?: unknown };
    if (typeof password === 'string' && password.length > 0) {
      if (password.length < 4) return res.status(400).json({ ok: false, error: '新密码至少 4 位' });
      updatePassword(name, password);
    }
    if (Array.isArray(projectIds)) {
      const ids = projectIds.filter((v): v is string => typeof v === 'string');
      setUserProjects(name, ids); // 全量重写;超管身份的分配无意义但无害
    }
    res.json({ ok: true, data: { users: userViews() } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// DELETE /api/users/:username — 删除账号(不能删自己)
router.delete('/api/users/:username', requireSuperadmin, (req: Request, res: Response) => {
  try {
    const name = String(req.params.username || '');
    const me = reqUser(req)?.username;
    if (name === me) return res.status(400).json({ ok: false, error: '不能删除当前登录的账号' });
    if (!findUser(name)) return res.status(404).json({ ok: false, error: `用户 ${name} 不存在` });
    deleteUser(name);
    res.json({ ok: true, data: { users: userViews() } });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

export default router;
