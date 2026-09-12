// ── Config routes(仅全局设置;groups/databases 已随项目下沉) ──

import { Router, Request, Response } from 'express';
import { getGlobalSettings, setReviewMode } from '../config-manager';
import { route, errorMessage } from '../utils/route-utils';
import {
  getSecurityConfig, saveSecurityConfig, getSecurityStatus,
  generateSecretPath, generateCookieSecret, validateSecretPath, setGateCookie,
} from '../security/stealth';

const router = Router();

// 获取全局设置(reviewMode + ttyd + terminalDefaultCwd + jwt + security)
router.get('/api/config', route((_req: Request, res: Response) => {
  res.json(getGlobalSettings());
}));

// 保存:reviewMode(全局)+ security(安全模式:开关/自定义路径/重新生成/吊销解锁)
router.put('/api/config', route((req: Request, res: Response) => {
  try {
    const reviewMode = (req.body as { reviewMode?: unknown })?.reviewMode;
    if (typeof reviewMode === 'boolean') setReviewMode(reviewMode);

    const security = (req.body as { security?: Record<string, unknown> })?.security;
    if (security && typeof security === 'object') {
      const cfg = getSecurityConfig();

      if (typeof security.secretPath === 'string' && security.secretPath.trim()) {
        const p = security.secretPath.trim();
        const err = validateSecretPath(p);
        if (err) {
          res.status(400).json({ ok: false, error: err });
          return;
        }
        cfg.secretPath = p;
      }
      if (security.regeneratePath === true) cfg.secretPath = generateSecretPath();
      if (security.revokeCookies === true) cfg.cookieSecret = generateCookieSecret();
      if (typeof security.enabled === 'boolean') cfg.enabled = security.enabled;

      // 开启时确保秘密链接与 cookie 密钥都已生成
      if (cfg.enabled) {
        if (!cfg.secretPath) cfg.secretPath = generateSecretPath();
        if (!cfg.cookieSecret) cfg.cookieSecret = generateCookieSecret();
      }
      saveSecurityConfig(cfg);

      // 只要在开启状态下操作,就给当前浏览器种解锁 cookie —— 操作者不会把自己锁在外面
      if (cfg.enabled) setGateCookie(res, cfg.cookieSecret);
    }

    res.json({
      ok: true,
      reviewMode: getGlobalSettings().reviewMode,
      security: getSecurityStatus(),
    });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    res.status(400).json({ ok: false, error: msg });
  }
}));

export default router;
