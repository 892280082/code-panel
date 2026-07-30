// ── Terminal routes: status, sessions, commands ─────────────

import { Router, Request, Response } from 'express';
import { getTTYDStatus, createSession, killSession, getSessions } from '../terminal/ttyd-manager';
import { getAllCommands, addCommand, deleteCommand, updateCommand, reorderCommands } from '../terminal/command-store';

const router = Router();

// ── Status ────────────────────────────────────────────────

// GET /api/terminal/status — 查询 FAB 终端状态
router.get('/api/terminal/status', (_req: Request, res: Response) => {
  const status = getTTYDStatus();
  res.json({ ok: true, ...status });
});

// ── Sessions ──────────────────────────────────────────────

// POST /api/terminal/sessions — 创建命令终端 session
router.post('/api/terminal/sessions', async (req: Request, res: Response) => {
  const { label, command, cwd } = req.body;

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
    (cwd && typeof cwd === 'string') ? cwd.trim() : ''
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
});

// GET /api/terminal/sessions — 列出活跃 session
router.get('/api/terminal/sessions', (_req: Request, res: Response) => {
  const sessions = getSessions();
  res.json({ ok: true, data: sessions });
});

// DELETE /api/terminal/sessions/:port — 关闭终端 session
router.delete('/api/terminal/sessions/:port', (req: Request, res: Response) => {
  const port = parseInt(req.params.port);
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
});

// ── Commands ──────────────────────────────────────────────

// GET /api/terminal/commands?group=xxx — 查询命令按钮（按分组筛选）
router.get('/api/terminal/commands', (req: Request, res: Response) => {
  const group = req.query.group as string | undefined;
  const commands = getAllCommands(group || undefined);
  res.json({ ok: true, data: commands });
});

// POST /api/terminal/commands — 注册命令按钮
router.post('/api/terminal/commands', (req: Request, res: Response) => {
  const { label, command, cwd, group } = req.body;

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

  const entry = addCommand(
    label.trim(),
    command.trim(),
    cwd && typeof cwd === 'string' ? cwd.trim() : undefined,
    group && typeof group === 'string' ? group.trim() : undefined
  );

  res.status(201).json({ ok: true, data: entry });
});

// PUT /api/terminal/commands/reorder — 重排自定义命令
router.put('/api/terminal/commands/reorder', (req: Request, res: Response) => {
  const { ids, group } = req.body;
  if (!Array.isArray(ids) || ids.some((id: any) => typeof id !== 'string')) {
    res.status(400).json({ ok: false, error: 'ids must be a string array' });
    return;
  }
  reorderCommands(ids, group || undefined);
  res.json({ ok: true });
});

// PUT /api/terminal/commands/:id — 编辑命令按钮
router.put('/api/terminal/commands/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { label, command, cwd, group } = req.body;

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

  const updated = updateCommand(id, { label, command, cwd, group });
  if (!updated) {
    res.status(404).json({ ok: false, error: 'command not found or is system command' });
    return;
  }
  res.json({ ok: true, data: updated });
});

// DELETE /api/terminal/commands/:id — 删除命令按钮
router.delete('/api/terminal/commands/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = deleteCommand(id);
  if (!deleted) {
    res.status(404).json({ ok: false, error: 'command not found or is system command' });
    return;
  }
  res.json({ ok: true });
});

export default router;
