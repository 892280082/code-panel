// ── Backup routes: 定期备份配置 + 执行 + 列表 + 下载 ─────

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getBackupPath, setBackupPath, runBackup, listBackups, MAX_KEEP } from '../backup/backup-manager';
import { route } from '../utils/route-utils';

const router = Router();

// GET /api/backup/config — 查询备份配置
router.get('/api/backup/config', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: { path: getBackupPath(), maxKeep: MAX_KEEP } });
}));

// PUT /api/backup/config — 设置备份路径
router.put('/api/backup/config', route((req: Request, res: Response) => {
  const { path: dir } = req.body;
  if (!dir || typeof dir !== 'string' || !dir.trim()) {
    res.status(400).json({ ok: false, error: 'path is required' });
    return;
  }
  if (!dir.trim().startsWith('/')) {
    res.status(400).json({ ok: false, error: 'path must be an absolute path (start with /)' });
    return;
  }
  const p = setBackupPath(dir);
  res.json({ ok: true, data: { path: p, maxKeep: MAX_KEEP } });
}));

// GET /api/backup/list — 列出备份文件(最新在前)
router.get('/api/backup/list', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: listBackups(), maxKeep: MAX_KEEP });
}));

// POST /api/backup/run — 立即备份(同天覆盖)
router.post('/api/backup/run', route((_req: Request, res: Response) => {
  const r = runBackup();
  if (!r.ok) {
    res.status(500).json({ ok: false, error: r.error });
    return;
  }
  res.json({ ok: true, data: { file: r.file } });
}));

// GET /api/backup/download/:name — 下载备份文件(仅限 backup-YYYY-MM-DD.tar.gz 格式,防路径注入)
router.get('/api/backup/download/:name', route((req: Request, res: Response) => {
  const name = String(req.params.name);
  if (!/^backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(name)) {
    res.status(400).json({ ok: false, error: 'invalid backup name' });
    return;
  }
  const file = path.join(getBackupPath(), name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ ok: false, error: 'backup not found' });
    return;
  }
  res.download(file, name);
}));

export default router;
