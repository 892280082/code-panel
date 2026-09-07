// ── 安全模式(隐身/防探测)────────────────────────────────
//   开启后:不知道秘密链接的访问者无论访问什么路径(页面 + 全部 /api/*,
//   含 /api/auth/login)一律返回与 Express 默认无差别的 404;
//   访问秘密链接一次 → 种 cp_gate cookie(90 天)→ 302 /login,
//   此后该浏览器一切正常,原有 JWT 逻辑照旧。
//   配置存 ~/.code-panel/data.db settings 表 key=security(重启仍生效)。
//   忘记秘密链接:本机查 data.db settings 表(key=security)。

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getSetting, setSetting } from '../db/global-store';
import { readCookie } from '../auth/jwt';

export const GATE_COOKIE = 'cp_gate';
export const GATE_COOKIE_MAX_AGE = 90 * 24 * 3600; // 90 天(秒)

export interface SecurityConfig {
  enabled: boolean;
  secretPath: string;   // 秘密入口路径,如 /gate-x7Kp9…(128bit 随机)
  cookieSecret: string; // gate cookie 值(与 secretPath 独立;换它 = 踢掉所有已解锁浏览器)
}

const DEFAULT: SecurityConfig = { enabled: false, secretPath: '', cookieSecret: '' };

export function getSecurityConfig(): SecurityConfig {
  const saved = getSetting<Partial<SecurityConfig>>('security', {});
  return { ...DEFAULT, ...saved };
}

export function saveSecurityConfig(cfg: SecurityConfig): void {
  setSetting('security', cfg);
}

/** 前端可见的安全状态(不含 cookieSecret,需 JWT 才能拿到) */
export function getSecurityStatus(): { enabled: boolean; secretPath: string } {
  const cfg = getSecurityConfig();
  return { enabled: cfg.enabled, secretPath: cfg.secretPath };
}

/** 随机秘密路径:/gate-<128bit base64url> */
export function generateSecretPath(): string {
  return '/gate-' + crypto.randomBytes(16).toString('base64url');
}

/** 随机 gate cookie 值(256bit hex) */
export function generateCookieSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** 自定义路径校验:/ 开头、仅 [A-Za-z0-9_-]、总长 8~128,且避开现有页面/API */
export function validateSecretPath(p: string): string | null {
  if (!/^\/[A-Za-z0-9_-]{7,127}$/.test(p)) {
    return '路径需以 / 开头,仅含字母/数字/-/_ 且总长 8~128 位(如 /gate-x7Kp9mQ2)';
  }
  if (/^\/(api|assets|favicon)/.test(p)) return '不能以 /api、/assets、/favicon 开头';
  if (['/login', '/log', '/sql', '/prd', '/git', '/terminal'].includes(p)) {
    return '不能与现有页面路径冲突';
  }
  return null;
}

/** 常量时间比较(避免逐字节泄露) */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 在 Express 请求上判断是否已解锁 */
export function isGateUnlocked(req: Request): boolean {
  const cfg = getSecurityConfig();
  if (!cfg.enabled) return true;
  const v = readCookie(req, GATE_COOKIE);
  return !!v && safeEqual(v, cfg.cookieSecret);
}

/** 原始 HTTP 请求(WS 升级不走 Express)上判断是否已解锁 */
export function isGateUnlockedRaw(headers: { cookie?: string | string[] | undefined }): boolean {
  const cfg = getSecurityConfig();
  if (!cfg.enabled) return true;
  const raw = Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie;
  if (!raw) return false;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== GATE_COOKIE) continue;
    let v = part.slice(eq + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* 保留原样 */ }
    if (v && safeEqual(v, cfg.cookieSecret)) return true;
  }
  return false;
}

/** 种 gate cookie(90 天,HttpOnly;仿 setAuthCookie 手拼) */
export function setGateCookie(res: Response, cookieSecret: string): void {
  res.setHeader('Set-Cookie', [
    `${GATE_COOKIE}=${encodeURIComponent(cookieSecret)}`,
    'Path=/', 'SameSite=Lax', 'HttpOnly', `Max-Age=${GATE_COOKIE_MAX_AGE}`,
  ].join('; '));
}

// ── Express 中间件(挂全链路最前,先于 static / SPA fallback / json)──

export function stealthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cfg = getSecurityConfig();
  if (!cfg.enabled) return next();

  // 秘密入口:种 cookie → 跳登录页(容忍尾斜杠)
  if (cfg.secretPath && (req.path === cfg.secretPath || req.path === cfg.secretPath + '/')) {
    setGateCookie(res, cfg.cookieSecret);
    res.redirect('/login');
    return;
  }

  // 已解锁浏览器 → 放行
  const v = readCookie(req, GATE_COOKIE);
  if (v && safeEqual(v, cfg.cookieSecret)) return next();

  // 其余一切:与 Express 默认 404 无差别,不暴露任何信息、不种 cookie
  let path = req.path;
  try { path = decodeURIComponent(req.path); } catch { /* 保留原样 */ }
  res.status(404).send(`Cannot ${req.method} ${path}`);
}
