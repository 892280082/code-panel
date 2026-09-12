// ── Tmux 持久化终端路由 ──────────────────────────────────
//   list/create/attach + 断开/删除。所有操作都带 ?project= 或 body.project,
//   项目范围由 requireProject 校验。物理 tmux 会话名带 p_<projectId>_ 前缀,
//   备注落在项目自己的 .code-panel/data/tmux-notes.json。
//
//   前端 iframe 统一用 /api/terminal/<port>/?token=<JWT> 连接,
//   attach 只返回端口,token 由前端自己拼(与其他终端一致)。

import { Router, Request, Response } from 'express';
import { requireProject, reqProject, canAccessProject } from '../projects/context';
import { reqUser } from '../auth/jwt';
import { listUserProjectIds } from '../db/global-store';
import { route, errorMessage } from '../utils/route-utils';
import {
  listTmuxSessions, createTmuxSession, startTmuxAttach,
  stopTmuxAttach, killTmuxSession, resolveTmuxName,
  captureTmuxPane, setTmuxMouse,
} from '../terminal/tmux-manager';

const router = Router();

// GET /api/terminal/tmux/list?project=<id> — 列出 tmux 会话(含备注)
//   带 project 时按项目过滤(未分配该项目 → 403);不带则返回宿主全部
//   —— 按登录用户收口:超管见全部;普通用户仅见被分配项目(user_projects)的会话,
//   未归属到任何项目的孤儿会话(project=null)对普通用户一律不可见。
router.get('/api/terminal/tmux/list', route(async (req: Request, res: Response) => {
  try {
    const sessions = await listTmuxSessions();
    const projectId = typeof req.query.project === 'string' ? req.query.project.trim() : '';
    if (projectId && !canAccessProject(req, projectId)) {
      res.status(403).json({ ok: false, error: '无该项目权限' });
      return;
    }
    let data = projectId
      ? sessions.filter(s => s.project === projectId)
      : sessions;
    const user = reqUser(req);
    if (user && user.role !== 'superadmin') {
      const visible = new Set(listUserProjectIds(user.username));
      data = data.filter(s => s.project !== null && visible.has(s.project));
    }
    res.json({ ok: true, data });
  } catch {
    // tmux 未安装或无会话 → 空列表
    res.json({ ok: true, data: [] });
  }
}));

// POST /api/terminal/tmux/create — 创建 detached tmux 会话
// body: { project, name, description? }
router.post('/api/terminal/tmux/create', requireProject, route(async (req: Request, res: Response) => {
  const project = reqProject(req);
  const { name, description } = (req.body ?? {}) as { name?: unknown; description?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ ok: false, error: '请提供会话名称' });
    return;
  }
  try {
    const fullName = await createTmuxSession(
      project,
      name.trim(),
      typeof description === 'string' ? description : undefined,
    );
    // 返回物理名 + 展示名,前端创建后直接用它 attach
    res.status(201).json({ ok: true, data: { name: name.trim(), fullName } });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(400).json({ ok: false, error: msg });
  }
}));

// GET /api/terminal/tmux/capture?project=<id>&name=<物理名>&lines=200
//   抓取会话屏幕文本(网页复制的唯一可靠通道 —— mouse on 截获拖选,ttyd 无 OSC52)
router.get('/api/terminal/tmux/capture', requireProject, route(async (req: Request, res: Response) => {
  const project = reqProject(req);
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  const lines = parseInt(String(req.query.lines ?? ''), 10) || 200;
  if (!name.trim()) {
    res.status(400).json({ ok: false, error: '请提供会话名称' });
    return;
  }
  try {
    const text = await captureTmuxPane(project, name, lines);
    res.json({ ok: true, data: { text } });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(msg.includes('不属于该项目') ? 403 : 500).json({ ok: false, error: msg });
  }
}));

// PUT /api/terminal/tmux/mouse — 会话级鼠标模式开关 body { project, name, enabled }
router.put('/api/terminal/tmux/mouse', requireProject, route(async (req: Request, res: Response) => {
  const project = reqProject(req);
  const { name, enabled } = (req.body ?? {}) as { name?: unknown; enabled?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ ok: false, error: '请提供会话名称' });
    return;
  }
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ ok: false, error: 'enabled 需为布尔值' });
    return;
  }
  try {
    await setTmuxMouse(project, name, enabled);
    res.json({ ok: true, data: { enabled } });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(msg.includes('不属于该项目') ? 403 : 500).json({ ok: false, error: msg });
  }
}));

// POST /api/terminal/tmux/attach — 为已有 tmux session 启动 ttyd,返回端口
// body: { project, name }  (name 可为展示名或物理名 p_<project>_<name>)
router.post('/api/terminal/tmux/attach', requireProject, route(async (req: Request, res: Response) => {
  const project = reqProject(req);
  const { name } = (req.body ?? {}) as { name?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ ok: false, error: '请提供会话名称' });
    return;
  }
  try {
    const port = await startTmuxAttach(project, name.trim());
    // sessionName 用物理名,前端作为会话唯一 key
    const fullName = resolveTmuxName(project, name.trim());
    res.status(201).json({ ok: true, data: { port, sessionName: fullName } });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(500).json({ ok: false, error: msg });
  }
}));

// DELETE /api/terminal/tmux-sessions/:port — 断开 ttyd 接入(不杀 tmux 会话)
router.delete('/api/terminal/tmux-sessions/:port', route(async (req: Request, res: Response) => {
  const port = parseInt(String(req.params.port), 10);
  if (isNaN(port)) {
    res.status(400).json({ ok: false, error: '无效端口' });
    return;
  }
  await stopTmuxAttach(port);
  res.json({ ok: true });
}));

// DELETE /api/terminal/tmux/:name?project=<id> — 彻底删除 tmux 会话
//   (断开该会话所有 ttyd 接入 + kill tmux session + 清备注)
router.delete('/api/terminal/tmux/:name', requireProject, route(async (req: Request, res: Response) => {
  const project = reqProject(req);
  const name = String(req.params.name);
  try {
    await killTmuxSession(project, name);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(500).json({ ok: false, error: msg });
  }
}));

export default router;
