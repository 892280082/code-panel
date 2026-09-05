// ── JWT 密钥管理 + 签发/校验 + Express 中间件 ──────────
//   密钥持久化到 ~/.code-panel/jwt.secret(重启后旧 token 仍有效)
//   token 来源:Authorization: Bearer ∥ ?token=(SSE/iframe) ∥ cookie cp_auth(同源子资源)

import crypto from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { JWT_SECRET_PATH, globalDataDir } from '../paths';
import { getSetting } from '../db/global-store';

export const AUTH_COOKIE = 'cp_auth';

// ── 密钥加载(参考 fork:load-or-create, 0o600, 64hex) ──

function loadOrCreateSecret(): Buffer {
  try {
    const hex = fs.readFileSync(JWT_SECRET_PATH, 'utf8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  } catch { /* 不存在 → 生成 */ }

  const dir = globalDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const secret = crypto.randomBytes(32);
  const tmp = JWT_SECRET_PATH + '.tmp';
  fs.writeFileSync(tmp, secret.toString('hex'), { mode: 0o600 });
  fs.renameSync(tmp, JWT_SECRET_PATH);
  console.log('[JWT] 密钥已生成:', JWT_SECRET_PATH);
  return secret;
}

const SECRET = loadOrCreateSecret();

// ── JWT Payload ─────────────────────────────────────────

export interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

export function getExpiryHours(): number {
  const c = getSetting<{ expiryHours?: number }>('jwt', { expiryHours: 24 });
  return c?.expiryHours ?? 24;
}

// ── 签发 / 校验 ─────────────────────────────────────────

export function signToken(username: string): string {
  const expiryHours = getExpiryHours();
  return jwt.sign({ username }, SECRET, { algorithm: 'HS256', expiresIn: `${expiryHours}h` });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}

// ── cookie 解析(不引 cookie-parser) ─────────────────────

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return undefined;
}

/** 设置/清除 cp_auth cookie(remember→持久,否则会话 cookie) */
export function setAuthCookie(res: Response, token: string | null, remember: boolean): void {
  const parts = [`${AUTH_COOKIE}=${encodeURIComponent(token ?? '')}`, 'Path=/', 'SameSite=Lax', 'HttpOnly'];
  if (token) {
    const maxAge = getExpiryHours() * 3600;
    if (remember) parts.push(`Max-Age=${maxAge}`);
  } else {
    parts.push('Max-Age=0'); // 清除
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function extractBearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim() || undefined;
  return undefined;
}

// ── Express JWT 校验中间件 ──────────────────────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 非 API 路由放行(static / SPA)
  if (!req.path.startsWith('/api/')) return next();

  const token = extractBearer(req)
    || (typeof req.query.token === 'string' ? req.query.token : undefined)
    || readCookie(req, AUTH_COOKIE);

  if (!token) {
    res.status(401).json({ ok: false, error: '未授权，请先登录' });
    return;
  }
  try {
    verifyToken(token);
    next();
  } catch {
    res.status(401).json({ ok: false, error: '登录已过期，请重新登录' });
  }
}
