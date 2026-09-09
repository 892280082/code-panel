// ── read-log v3 (Vue 3) — Log Viewer + SQL Review Panel ──

import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';

import logsRouter from './routes/logs';
import configRouter from './routes/config';
import databasesRouter from './routes/databases';
import redisRouter from './routes/redis';
import { closeAllRedis } from './db/redis-client';
import sqlExecRouter from './routes/sql-exec';
import sqlReviewRouter from './routes/sql-review';
import sqlHistoryRouter from './routes/sql-history';
import prdRouter from './routes/prd';
import terminalRouter from './routes/terminal';
import tmuxRouter from './routes/tmux';
import launchRouter from './routes/launch';
import backupRouter from './routes/backup';
import gitReposRouter from './routes/git-repos';
import repoBrowserRouter from './routes/repo-browser';
import { runBackup } from './backup/backup-manager';
import { terminalProxyMiddleware, mountTerminalProxy } from './terminal/proxy';
import { startTTYD, stopTTYD } from './terminal/ttyd-manager';
import { killAllTmuxAttachSync, cleanupStaleTmuxAttachPorts } from './terminal/tmux-manager';
import { startMonitor } from './log-monitor';
import { startHealthCheck } from './db/health-check';
import { initGlobalStore } from './db/global-store';
import { authMiddleware } from './auth/jwt';
import authRouter, { protectedAuthRouter } from './routes/auth';
import projectsRouter from './routes/projects';
import usersRouter from './routes/users';
import linksRouter from './routes/links';
import resourcesRouter from './routes/resources';
import filesRouter from './routes/files';
import envRouter from './routes/env';
import nginxRouter from './routes/nginx';
import { stealthMiddleware } from './security/stealth';

const app = express();
const PORT = 3008;
const DIST_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// ── Middleware ────────────────────────────────────────────
app.use(stealthMiddleware);           // 安全模式(隐身):开启后未解锁一律 404,必须先于 static/SPA/json
app.use(express.json({ limit: '2mb' }));

// Serve Vue build output
app.use(express.static(DIST_DIR));
// Serve legacy static assets (fonts, etc.)
app.use(express.static(PUBLIC_DIR));

// ── Auth（JWT）────────────────────────────────────────────
app.use(authRouter);                 // 公开：POST /api/auth/login
app.use(authMiddleware);             // 保护其余全部 /api/*
app.use(protectedAuthRouter);        // 需登录：logout / change-password

// Terminal proxy（HTTP，转发到 ttyd 进程）
app.use(terminalProxyMiddleware);

// ── API routes ───────────────────────────────────────────
app.use(logsRouter);
app.use(configRouter);
app.use(databasesRouter);
app.use(redisRouter);
app.use(sqlExecRouter);
app.use(sqlReviewRouter);
app.use(sqlHistoryRouter);
app.use(prdRouter);
app.use(terminalRouter);
app.use(tmuxRouter);
app.use(launchRouter);
app.use(backupRouter);
app.use(gitReposRouter);
app.use(repoBrowserRouter);
app.use(projectsRouter);
app.use(usersRouter);
app.use(linksRouter);
app.use(resourcesRouter);
app.use(filesRouter);
app.use(envRouter);
app.use(nginxRouter);

// ── SPA fallback — all non-API routes serve index.html ───
const indexHtml = path.join(DIST_DIR, 'index.html');
app.use((req, res, next) => {
  // Only handle GET requests that aren't API routes
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  if (fs.existsSync(indexHtml)) {
    res.type('html').send(fs.readFileSync(indexHtml, 'utf8'));
  } else {
    // Fallback: serve legacy log.html during development
    const legacy = path.join(PUBLIC_DIR, 'log.html');
    if (fs.existsSync(legacy)) {
      res.type('html').send(fs.readFileSync(legacy, 'utf8'));
    } else {
      res.status(404).send('Frontend not built. Run: cd frontend && npm run build');
    }
  }
});

// ── Start ────────────────────────────────────────────────
async function start() {
  // P2:不再初始化 db-config.sqlite;全局库只放 users/projects/settings
  await initGlobalStore();

  // P3:清理上次服务器残留的 tmux 接入 ttyd(9020-9029);tmux 会话本身常驻保留
  cleanupStaleTmuxAttachPorts();

  await startTTYD();
  startMonitor();
  startHealthCheck();

  // 程序启动自动备份一次(同天覆盖替换),路径未配置时跳过
  const backupRes = runBackup();
  if (backupRes.ok) {
    console.log(`✓ Backup → ${backupRes.file}`);
  } else {
    console.log(`⚠ Backup skipped: ${backupRes.error}`);
  }

  const server = http.createServer(app);

  // WebSocket 代理（在 HTTP server 升级事件上）
  mountTerminalProxy(server);

  server.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════════╗`);
    console.log(`║  Log Viewer  →  http://localhost:${PORT}/log      ║`);
    console.log(`║  SQL Review  →  http://localhost:${PORT}/sql      ║`);
    console.log(`║  Terminal    →  http://localhost:${PORT}/terminal ║`);
    console.log(`╚══════════════════════════════════════════════╝`);
  });

  // graceful shutdown
  const shutdown = () => {
    closeAllRedis(); // 关闭 Redis 客户端连接
    stopTTYD();
    killAllTmuxAttachSync(); // 只断 ttyd 接入,tmux session 保持常驻
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
