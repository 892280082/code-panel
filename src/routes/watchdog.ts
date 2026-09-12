// ── 看门狗路由(⚙ →「安全」Tab)──────────────────────────
//   status 登录即可看;install/uninstall 仅超管。

import { Router, Request, Response } from 'express';
import { route } from '../utils/route-utils';
import { requireSuperadmin } from '../auth/jwt';
import { watchdogStatus, installWatchdog, uninstallWatchdog } from '../security/watchdog';

export const watchdogRouter = Router();

watchdogRouter.get('/api/security/watchdog', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: watchdogStatus() });
}));

watchdogRouter.post('/api/security/watchdog/install', requireSuperadmin, route((_req: Request, res: Response) => {
  res.json({ ok: true, data: installWatchdog() });
}));

watchdogRouter.post('/api/security/watchdog/uninstall', requireSuperadmin, route((_req: Request, res: Response) => {
  res.json({ ok: true, data: uninstallWatchdog() });
}));
