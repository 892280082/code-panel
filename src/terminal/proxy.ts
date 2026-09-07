// ── Terminal proxy: /api/terminal → localhost:9001 (FAB)
//                      /api/terminal/:port → dynamic (command/tmux sessions)
//   HTTP + WebSocket 代理,JWT token 验证 + 端口授权窗口。
//
//   ★ P3 关闭认证漏洞:ttyd 的 HTTP 页与 WS 升级通道都必须持有合法 JWT。
//     - token 来源:URL ?token=(iframe/terminal 页带的) ∥ cookie cp_auth(同源子资源)
//     - 校验用 src/auth/jwt.ts 的 verifyToken
//     - 通过校验后给端口授权 30s:兼容 ttyd 内部发起的 WS 升级不带 token 的场景
//   ★ 绕过名单(这些是真实 API 路由,不转发给 ttyd):
//     /api/terminal/status、/api/terminal/commands、/api/terminal/sessions、
//     /api/terminal/tmux、/api/terminal/tmux-sessions

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'http';
import type { Duplex } from 'stream';
import { verifyToken, AUTH_COOKIE } from '../auth/jwt';
import { getConfig } from '../config-manager';
import { isGateUnlockedRaw } from '../security/stealth';

const PROXY_HOST = '127.0.0.1';
const FAB_PORT = 9001;

function getDefaultTTYDPort(): number {
  const config = getConfig();
  return config.ttyd?.port ?? FAB_PORT;
}

// ── URL 解析 ──────────────────────────────────────────────

function extractToken(url: string): string | null {
  try {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.get('token');
  } catch {
    return null;
  }
}

function resolvePort(url: string): number {
  const match = url?.match(/^\/api\/terminal\/(\d+)(\/.*)?$/);
  if (match) return parseInt(match[1], 10);
  return getDefaultTTYDPort();
}

/** 从 cookie 头解析 cp_auth(WS 升级也带同源 cookie,无需引 cookie-parser) */
function tokenFromCookie(req: { headers?: IncomingMessage['headers'] }): string | null {
  const header = req.headers?.cookie;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === AUTH_COOKIE) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()) || null; } catch { return null; }
    }
  }
  return null;
}

/** 从 Authorization: Bearer 头取 token(兼容 API 客户端直连终端流) */
function tokenFromAuthHeader(req: { headers?: IncomingMessage['headers'] }): string | null {
  const h = req.headers?.authorization;
  const raw = Array.isArray(h) ? h[0] : h;
  if (!raw || !raw.startsWith('Bearer ')) return null;
  const t = raw.slice(7).trim();
  return t || null;
}

// ── 端口授权窗口 ──────────────────────────────────────────
//   ttyd 页面加载后由内部 JS 发起 WS 升级,可能不带 ?token=。
//   首次 HTTP(带 token)通过后授权该端口 30s,期间 WS 升级放行。

const PORT_AUTH_TTL = 30_000;
const authorized = new Map<number, number>();

function authorizePort(port: number): void {
  authorized.set(port, Date.now() + PORT_AUTH_TTL);
}

function isPortAuthorized(port: number): boolean {
  const expiry = authorized.get(port);
  if (expiry && Date.now() < expiry) return true;
  authorized.delete(port);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [p, exp] of authorized) {
    if (now > exp) authorized.delete(p);
  }
}, 300_000);

// ── 认证检查 ──────────────────────────────────────────────

/** 校验 JWT:URL ?token= 或 cookie;失败时由调用方决定 403。 */
function checkAuth(req: IncomingMessage, port: number): 'ok' | 'missing' | 'invalid' {
  const token = extractToken(req.url || '') || tokenFromCookie(req) || tokenFromAuthHeader(req);
  if (!token) {
    // 端口在授权窗口内 → 放行(比如 ttyd 内部发起的无 token WS)
    if (isPortAuthorized(port)) return 'ok';
    return 'missing';
  }
  try {
    verifyToken(token);
    authorizePort(port);
    return 'ok';
  } catch {
    return 'invalid';
  }
}

// ── 拒绝辅助 ──────────────────────────────────────────────

function denyRequest(res: ServerResponse, reason: string): void {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: `终端访问被拒绝: ${reason}` }));
}

function denyUpgrade(socket: Duplex, reason: string): void {
  socket.write(
    'HTTP/1.1 403 Forbidden\r\n' +
    'Content-Type: application/json\r\n' +
    `X-Terminal-Error: ${reason}\r\n` +
    '\r\n' +
    JSON.stringify({ ok: false, error: `终端访问被拒绝: ${reason}` }),
  );
  socket.destroy();
}

/** 取目标 ttyd 路径:/api/terminal/<port>/<path> → /<path>;/api/terminal/<path> → /<path> */
function extractTargetPath(url: string): string {
  const mPort = url.match(/^\/api\/terminal\/(\d+)(\/.*)?$/);
  if (mPort && mPort[2]) return mPort[2];
  const mFab = url.match(/^\/api\/terminal(\/.*)?$/);
  if (mFab && mFab[1]) return mFab[1];
  return '/';
}

// ── WebSocket 代理(挂 HTTP server upgrade 事件)────────────

export function mountTerminalProxy(httpServer: Server): void {
  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith('/api/terminal')) return;

    // ★ 安全模式(隐身)开启时,未解锁浏览器直接断开 —— 不暴露终端入口(WS 不走 Express 链)
    if (!isGateUnlockedRaw(req.headers)) {
      socket.destroy();
      return;
    }

    const port = resolvePort(req.url);
    socket.on('error', () => { socket.destroy(); });

    // ★ JWT 验证(WS 升级不走 express 中间件,必须在这里手动把关)
    const auth = checkAuth(req, port);
    if (auth !== 'ok') {
      denyUpgrade(socket, auth === 'missing' ? '缺少访问 token' : 'token 无效或已过期');
      return;
    }

    const targetPath = extractTargetPath(req.url);
    const proxyReq = http.request({
      hostname: PROXY_HOST,
      port,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${port}` },
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      proxySocket.on('error', () => { socket.destroy(); });
      socket.on('error', () => { proxySocket.destroy(); });
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') + '\r\n\r\n');
      socket.pipe(proxySocket);
      proxySocket.pipe(socket);
      if (proxyHead.length > 0) proxySocket.write(proxyHead);
    });

    proxyReq.on('error', () => { socket.destroy(); });
    proxyReq.end();
  });
}

// ── HTTP 代理中间件 ────────────────────────────────────────

export function terminalProxyMiddleware(
  req: IncomingMessage, res: ServerResponse, next: () => void,
): void {
  const path = req.url?.split('?')[0] || '';

  // 绕过名单:这些由真实 API 路由处理,不转发到 ttyd
  if (path === '/api/terminal/status') return next();
  if (path === '/api/terminal/commands' || path.startsWith('/api/terminal/commands/')) return next();
  if (path === '/api/terminal/sessions' || path.startsWith('/api/terminal/sessions/')) return next();
  if (path === '/api/terminal/tmux' || path.startsWith('/api/terminal/tmux')) return next();
  if (path === '/api/terminal/tmux-sessions' || path.startsWith('/api/terminal/tmux-sessions')) return next();
  if (!path.startsWith('/api/terminal')) return next();
  if (req.method === 'OPTIONS') return next();

  const port = resolvePort(req.url);

  // ★ JWT 验证(HTTP 通道;同源子资源可用 cp_auth cookie)
  const auth = checkAuth(req, port);
  if (auth !== 'ok') {
    denyRequest(res, auth === 'missing' ? '缺少访问 token' : 'token 无效或已过期');
    return;
  }

  const targetPath = extractTargetPath(req.url);
  const proxyReq = http.request({
    hostname: PROXY_HOST,
    port,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers as Record<string, string>, host: `localhost:${port}` },
  }, (proxyRes) => {
    proxyRes.on('error', () => { res.destroy(); });
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.on('error', () => { proxyReq.destroy(); });
  res.on('error', () => { proxyReq.destroy(); });

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '终端代理连接失败' }));
    }
  });

  req.pipe(proxyReq);
}
