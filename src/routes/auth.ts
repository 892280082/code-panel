// ── Auth routes ─────────────────────────────────────────
//   公开(白名单):POST /api/auth/login
//   需登录:POST /api/auth/logout、POST /api/auth/change-password(见 protectedAuthRouter)
//   账号校验走 users 表(global-store),不再是 config.json。

import { Router, Request, Response } from 'express';
import { signToken, setAuthCookie, verifyToken } from '../auth/jwt';
import { isLocked, recordFailure, recordSuccess } from '../auth/lockout';
import { verifyUser, findUser, updatePassword, sha256 } from '../db/global-store';

// ── 公开登录 ────────────────────────────────────────────

const router = Router();

router.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password, remember } = (req.body ?? {}) as {
    username?: string; password?: string; remember?: boolean;
  };

  if (!username || !password) {
    res.status(400).json({ ok: false, error: '请输入账号和密码' });
    return;
  }

  if (isLocked(username)) {
    res.status(403).json({ ok: false, error: '账号已被锁定，请手动重启服务' });
    return;
  }

  if (verifyUser(username, password)) {
    recordSuccess(username);
    const token = signToken(username);
    // 子资源/SSE 通道 cookie:记住→持久;否则会话 cookie
    setAuthCookie(res, token, !!remember);
    const user = findUser(username);
    res.json({ ok: true, token, username: user?.username ?? username });
  } else {
    const result = recordFailure(username);
    if (result.locked) {
      res.status(403).json({ ok: false, error: '账号已被锁定，请手动重启服务' });
    } else {
      res.status(401).json({ ok: false, error: `账号或密码错误，还剩 ${result.remaining} 次尝试` });
    }
  }
});

// ── 需登录(挂载在 authMiddleware 之后) ─────────────────

export const protectedAuthRouter = Router();

protectedAuthRouter.post('/api/auth/logout', (_req: Request, res: Response) => {
  setAuthCookie(res, null, false); // 清 cookie
  res.json({ ok: true });
});

protectedAuthRouter.post('/api/auth/change-password', (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token) { res.status(401).json({ ok: false, error: '未授权' }); return; }
  let username: string;
  try {
    username = verifyToken(token).username;
  } catch {
    res.status(401).json({ ok: false, error: '登录已过期，请重新登录' });
    return;
  }
  const { oldPassword, newPassword } = (req.body ?? {}) as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword) {
    res.status(400).json({ ok: false, error: '请输入旧密码和新密码' });
    return;
  }
  const user = findUser(username);
  if (!user || sha256(oldPassword) !== user.password_hash) {
    res.status(400).json({ ok: false, error: '旧密码不正确' });
    return;
  }
  if (newPassword.length < 4) {
    res.status(400).json({ ok: false, error: '新密码至少 4 位' });
    return;
  }
  updatePassword(username, newPassword);
  res.json({ ok: true });
});

export default router;
