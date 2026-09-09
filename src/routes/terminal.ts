// ── Terminal routes: status, sessions, commands ─────────────

import { Router, Request, Response } from 'express';
import { requireProject, reqProject } from '../projects/context';
import { getTTYDStatus, createSession, killSession, getSessions } from '../terminal/ttyd-manager';
import { getAllCommands, addCommand, deleteCommand, updateCommand, reorderCommands } from '../terminal/command-store';
import { route } from '../utils/route-utils';

const router = Router();

// ── Status ────────────────────────────────────────────────

// GET /api/terminal/status — 查询 FAB 终端状态
router.get('/api/terminal/status', route((_req: Request, res: Response) => {
  const status = getTTYDStatus();
  res.json({ ok: true, ...status });
}));

// ── Sessions ──────────────────────────────────────────────

// POST /api/terminal/sessions — 创建命令终端 session
router.post('/api/terminal/sessions', route(async (req: Request, res: Response) => {
  const { label, command, cwd, keepShell } = req.body;

  if (!label || typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ ok: false, error: 'label is required' });
    return;
  }
  if (typeof command !== 'string') {
    res.status(400).json({ ok: false, error: 'command must be a string' });
    return;
  }

  const session = await createSession(
    label.trim(),
    command.trim(),
    (cwd && typeof cwd === 'string') ? cwd.trim() : '',
    keepShell !== false
  );

  if (!session) {
    res.status(503).json({ ok: false, error: 'No available terminal ports. Please close some terminals first.' });
    return;
  }

  res.status(201).json({
    ok: true,
    data: {
      port: session.port,
      label: session.label,
      command: session.command,
      cwd: session.cwd,
    }
  });
}));

// GET /api/terminal/sessions — 列出活跃 session
router.get('/api/terminal/sessions', route((_req: Request, res: Response) => {
  const sessions = getSessions();
  res.json({ ok: true, data: sessions });
}));

// DELETE /api/terminal/sessions/:port — 关闭终端 session
router.delete('/api/terminal/sessions/:port', route((req: Request, res: Response) => {
  const port = parseInt(String(req.params.port));
  if (isNaN(port)) {
    res.status(400).json({ ok: false, error: 'invalid port' });
    return;
  }
  const killed = killSession(port);
  if (!killed) {
    res.status(404).json({ ok: false, error: 'session not found' });
    return;
  }
  res.json({ ok: true });
}));

// ── Commands(自定义命令随项目;系统预设全局)────────────────

// GET /api/terminal/commands?project=xxx — 系统预设 + 该项目自定义命令
router.get('/api/terminal/commands', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const commands = getAllCommands(project);
  res.json({ ok: true, data: commands });
}));

// POST /api/terminal/commands — 注册命令按钮(落该项目 data/commands.json)
router.post('/api/terminal/commands', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const { label, command, cwd, subgroup } = req.body;

  if (!label || typeof label !== 'string' || !label.trim() || label.trim().length > 100) {
    res.status(400).json({ ok: false, error: 'label is required and must be 1-100 characters' });
    return;
  }

  if (!command || typeof command !== 'string' || !command.trim() || command.trim().length > 4096) {
    res.status(400).json({ ok: false, error: 'command is required and must be 1-4096 characters' });
    return;
  }

  if (cwd && typeof cwd === 'string' && cwd.trim()) {
    if (!cwd.trim().startsWith('/')) {
      res.status(400).json({ ok: false, error: 'cwd must be an absolute path (start with /)' });
      return;
    }
  }

  const entry = addCommand(project, {
    label: label.trim(),
    command: command.trim(),
    cwd: cwd && typeof cwd === 'string' ? cwd.trim() : undefined,
    subgroup: subgroup && typeof subgroup === 'string' ? subgroup.trim() : undefined,
  });

  res.status(201).json({ ok: true, data: entry });
}));

// PUT /api/terminal/commands/reorder — 重排该项目自定义命令
router.put('/api/terminal/commands/reorder', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some((id: any) => typeof id !== 'string')) {
    res.status(400).json({ ok: false, error: 'ids must be a string array' });
    return;
  }
  reorderCommands(project, ids);
  res.json({ ok: true });
}));

// PUT /api/terminal/commands/:id — 编辑命令按钮
router.put('/api/terminal/commands/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const id = String(req.params.id);
  const { label, command, cwd, subgroup } = req.body;

  if (label !== undefined && (typeof label !== 'string' || !label.trim() || label.trim().length > 100)) {
    res.status(400).json({ ok: false, error: 'label must be 1-100 characters' });
    return;
  }
  if (command !== undefined && (typeof command !== 'string' || !command.trim() || command.trim().length > 4096)) {
    res.status(400).json({ ok: false, error: 'command must be 1-4096 characters' });
    return;
  }
  if (cwd && typeof cwd === 'string' && cwd.trim() && !cwd.trim().startsWith('/')) {
    res.status(400).json({ ok: false, error: 'cwd must be an absolute path' });
    return;
  }

  const updated = updateCommand(project, id, { label, command, cwd, subgroup });
  if (!updated) {
    res.status(404).json({ ok: false, error: 'command not found or is system command' });
    return;
  }
  res.json({ ok: true, data: updated });
}));

// DELETE /api/terminal/commands/:id — 删除命令按钮
router.delete('/api/terminal/commands/:id', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const id = String(req.params.id);
  const deleted = deleteCommand(project, id);
  if (!deleted) {
    res.status(404).json({ ok: false, error: 'command not found or is system command' });
    return;
  }
  res.json({ ok: true });
}));

export default router;
