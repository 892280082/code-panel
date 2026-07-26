// ── read-log v3 (Vue 3) — Log Viewer + SQL Review Panel ──

import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

import logsRouter from './routes/logs';
import configRouter from './routes/config';
import logConfigRouter from './routes/log-config';
import databasesRouter from './routes/databases';
import sqlExecRouter from './routes/sql-exec';
import sqlReviewRouter from './routes/sql-review';
import { startMonitor } from './log-monitor';
import { startHealthCheck } from './db/health-check';
import { init as initDbConfig } from './db/db-config-store';

const app = express();
const PORT = 3008;
const DIST_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// ── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// Serve Vue build output
app.use(express.static(DIST_DIR));
// Serve legacy static assets (fonts, etc.)
app.use(express.static(PUBLIC_DIR));

// ── API routes ───────────────────────────────────────────
app.use(logsRouter);
app.use(configRouter);
app.use(logConfigRouter);
app.use(databasesRouter);
app.use(sqlExecRouter);
app.use(sqlReviewRouter);

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
  await initDbConfig();

  startMonitor();
  startHealthCheck();

  app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════════╗`);
    console.log(`║  Log Viewer  →  http://localhost:${PORT}/log      ║`);
    console.log(`║  SQL Review  →  http://localhost:${PORT}/sql      ║`);
    console.log(`╚══════════════════════════════════════════════╝`);

    const cmd = process.platform === 'darwin' ? 'open' :
                process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} http://localhost:${PORT}/log`, () => {});
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
