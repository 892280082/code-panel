// ── LLM 供应商切换 routes(全局作用域,非项目级)──────────────
//   GET    /api/llm/providers   登录   快照(vars 脱敏:敏感值 → ****尾4)
//   POST   /api/llm/providers   super  新增
//   PUT    /api/llm/providers/:id super 更新(值含 **** 的行=保留旧值,防脱敏回显固化)
//   DELETE /api/llm/providers/:id super 删除(删激活项 → 回落「不注入」)
//   POST   /api/llm/activate    super  {providerId: string|null} 选用/不注入
//   POST   /api/llm/mount       super  显式补挂 shell rc(幂等,对齐 /api/env/mount)

import { Router, Request, Response } from 'express';
import { requireSuperadmin } from '../auth/jwt';
import { route, errorMessage } from '../utils/route-utils';
import {
  getLlmProvider,
  addLlmProvider,
  updateLlmProvider,
  deleteLlmProvider,
  getLlmActive,
  setLlmActive,
} from '../db/global-store';
import {
  parseVars,
  mergeMaskedVars,
  materializeLlm,
  syncSettingsJson,
  ensureLlmRcMount,
  activateLlmProvider,
  revealProviderVars,
  llmSnapshot,
} from '../llm/provider-store';

const router = Router();

/** 校验 vars 并规范化(去 export 前缀/引号);失败抛带行号的错 */
function requireValidVars(vars: unknown): string {
  const text = String(vars ?? '');
  parseVars(text);   // 只校验,不改动原文(保存用户排版)
  return text;
}

// GET /api/llm/providers — 快照(登录即可;前端右上切换器/下拉要用)
router.get('/api/llm/providers', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: llmSnapshot() });
}));

// POST /api/llm/providers — 新增
router.post('/api/llm/providers', requireSuperadmin, route((req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; vars?: unknown; enabled?: unknown };
    const name = String(body.name ?? '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name 必填' });
    const vars = requireValidVars(body.vars);
    const row = addLlmProvider({ name, vars, enabled: body.enabled !== false });
    res.json({ ok: true, data: llmSnapshot() });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
}));

// GET /api/llm/providers/:id/reveal — 明文读取(super;UI 点👁 用,前端平时只拿脱敏值)
router.get('/api/llm/providers/:id/reveal', requireSuperadmin, route((req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: { vars: revealProviderVars(String(req.params.id)) } });
  } catch (e: unknown) {
    res.status(404).json({ ok: false, error: errorMessage(e) });
  }
}));

// PUT /api/llm/providers/:id — 更新(部分合并)
router.put('/api/llm/providers/:id', requireSuperadmin, route((req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = getLlmProvider(id);
    if (!existing) return res.status(404).json({ ok: false, error: `供应商 ${id} 不存在` });
    const body = (req.body ?? {}) as { name?: unknown; vars?: unknown; enabled?: unknown };
    const updates: { name?: string; vars?: string; enabled?: boolean } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ ok: false, error: 'name 不能为空' });
      updates.name = name;
    }
    if (body.vars !== undefined) {
      // 脱敏回显合并:值含 **** 的行保留旧值,再校验合法性
      updates.vars = requireValidVars(mergeMaskedVars(String(body.vars), existing.vars));
    }
    if (body.enabled !== undefined) updates.enabled = body.enabled === true;
    const merged = updateLlmProvider(id, updates);

    // 停用/编辑当前生效项 → 联动回落「不注入」;编辑的正是激活项且仍启用 → 重新物化
    const active = getLlmActive();
    if (active?.providerId === id) {
      if (!merged.enabled) {
        setLlmActive(null);
        materializeLlm(null);
        syncSettingsJson(null);
      } else {
        materializeLlm(merged);
        syncSettingsJson(merged);
      }
    }
    res.json({ ok: true, data: llmSnapshot() });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
}));

// DELETE /api/llm/providers/:id — 删除(删激活项 → 回落「不注入」)
router.delete('/api/llm/providers/:id', requireSuperadmin, route((req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!getLlmProvider(id)) return res.status(404).json({ ok: false, error: `供应商 ${id} 不存在` });
    deleteLlmProvider(id);
    const active = getLlmActive();
    if (active?.providerId === id) {
      setLlmActive(null);
      materializeLlm(null);
      syncSettingsJson(null);
    }
    res.json({ ok: true, data: llmSnapshot() });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
}));

// POST /api/llm/activate — 选用 {providerId: string} 或不注入 {providerId: null}
router.post('/api/llm/activate', requireSuperadmin, route((req: Request, res: Response) => {
  try {
    const raw = (req.body ?? {}).providerId;
    if (raw !== null && typeof raw !== 'string') {
      return res.status(400).json({ ok: false, error: 'providerId 必须是字符串或 null(不注入)' });
    }
    res.json({ ok: true, data: activateLlmProvider(typeof raw === 'string' ? raw.trim() : null) });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: errorMessage(e) });
  }
}));

// POST /api/llm/mount — 显式补挂 shell rc(幂等)
router.post('/api/llm/mount', requireSuperadmin, route((_req: Request, res: Response) => {
  res.json({ ok: true, data: ensureLlmRcMount() });
}));

export default router;
