// ── Terminal proxy: /api/terminal → localhost:9001 (FAB)
//                      /api/terminal/:port → dynamic (command sessions)
//   HTTP + WebSocket 代理

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'http';
import type { Duplex } from 'stream';
import { getConfig } from '../config-manager';

const PROXY_HOST = '127.0.0.1';
const FAB_PORT = 9001;

function getDefaultTTYDPort(): number {
  const config = getConfig();
  return config.ttyd?.port ?? FAB_PORT;
}

function resolvePort(url: string): number {
  const match = url?.match(/^\/api\/terminal\/(\d+)(\/.*)?$/);
  if (match) return parseInt(match[1]);
  return getDefaultTTYDPort();
}

// ── WebSocket 代理 ─────────────────────────────────────────

export function mountTerminalProxy(httpServer: Server): void {
  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith('/api/terminal')) return;

    const port = resolvePort(req.url);
    socket.on('error', () => { socket.destroy(); });

    // extract target path
    let targetPath = '/';
    const mPort = req.url.match(/^\/api\/terminal\/(\d+)(\/.*)?$/);
    if (mPort && mPort[2]) targetPath = mPort[2];
    else if (!mPort) {
      const mFab = req.url.match(/^\/api\/terminal(\/.*)?$/);
      if (mFab && mFab[1]) targetPath = mFab[1];
    }

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
  // 以下路径由 terminalRouter 处理，不代理到 ttyd
  const path = req.url?.split('?')[0] || '';
  if (path === '/api/terminal/status') return next();
  if (path === '/api/terminal/commands' || path.startsWith('/api/terminal/commands/')) return next();
  if (path === '/api/terminal/sessions' || path.startsWith('/api/terminal/sessions/')) return next();
  if (!path.startsWith('/api/terminal')) return next();
  if (req.method === 'OPTIONS') return next();

  const port = resolvePort(req.url);

  // extract target path
  let targetPath = '/';
  const mPort2 = req.url.match(/^\/api\/terminal\/(\d+)(\/.*)?$/);
  if (mPort2 && mPort2[2]) targetPath = mPort2[2];
  else if (!mPort2) {
    const mFab2 = req.url.match(/^\/api\/terminal(\/.*)?$/);
    if (mFab2 && mFab2[1]) targetPath = mFab2[1];
  }

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
