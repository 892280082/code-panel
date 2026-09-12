// ── LLM 供应商(llm_providers)—— 模型供应商切换 ──────────────
//   一套供应商 = 一段环境变量(vars,每行 KEY=VALUE,含 Key)。
//   激活态复用 settings 表('llmActive');settings.json 同步 manifest 也走 settings。

import crypto from 'crypto';
import { ensureDb, save } from './core';
import { getSetting, setSetting } from './settings';

export interface LlmProviderRow {
  id: string;
  name: string;
  vars: string;
  enabled: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface LlmActive {
  providerId: string | null;
  updatedAt: number;
}

function rowToLlmProvider(o: Record<string, unknown>): LlmProviderRow {
  return {
    id: o.id as string,
    name: o.name as string,
    vars: (o.vars as string) ?? '',
    enabled: (o.enabled as number ?? 1) === 1,
    sort_order: (o.sort_order as number) ?? 0,
    created_at: o.created_at as number,
    updated_at: o.updated_at as number,
  };
}

// ── 种子数据:全新安装自动预置 DeepSeek + 智谱 GLM 两条供应商(2026-09-11 用户定)──
//   变量段 9 键同构,token 为 <...> 占位符(用户只需填 Key;激活前防呆会拦未填项)
const LLM_SEED_PROVIDERS: { name: string; vars: string }[] = [
  {
    name: 'DeepSeek',
    vars: [
      'ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的DeepSeek Key>',
      'ANTHROPIC_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-flash[1m]',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash',
      'CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432',
    ].join('\n'),
  },
  {
    name: '智谱 GLM',
    vars: [
      'ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic',
      'ANTHROPIC_AUTH_TOKEN=<你的智谱 Key>',
      'ANTHROPIC_MODEL=glm-5.3-flash[1m]',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3[1m]',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.3-flash[1m]',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash[1m]',
      'CLAUDE_CODE_SUBAGENT_MODEL=glm-5.3-flash[1m]',
      'CLAUDE_CODE_EFFORT_LEVEL=max',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432',
    ].join('\n'),
  },
];

function seedLlmProvidersIfEmpty(d: ReturnType<typeof ensureDb>): void {
  const c = d.exec('SELECT COUNT(*) AS n FROM llm_providers');
  if (c.length && (c[0].values[0][0] as number) > 0) return; // 已有数据 = 非全新,不种子
  for (const s of LLM_SEED_PROVIDERS) addLlmProvider(s);
  save();
}

export function listLlmProviders(): LlmProviderRow[] {
  const d = ensureDb();
  seedLlmProvidersIfEmpty(d); // 全新安装自动预置;已有数据 = 空操作
  const r = d.exec('SELECT * FROM llm_providers ORDER BY sort_order, created_at');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return rowToLlmProvider(o);
  });
}

export function getLlmProvider(id: string): LlmProviderRow | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM llm_providers WHERE id = ?');
  stmt.bind([id]);
  let row: LlmProviderRow | undefined;
  if (stmt.step()) {
    row = rowToLlmProvider(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return row;
}

export function addLlmProvider(input: { id?: string; name: string; vars?: string; enabled?: boolean }): LlmProviderRow {
  const d = ensureDb();
  const id = input.id?.trim() || crypto.randomUUID();
  if (getLlmProvider(id)) throw new Error(`供应商 ${id} 已存在`);
  const now = Date.now();
  const sort = d.exec('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM llm_providers');
  const sortOrder = sort.length ? (sort[0].values[0][0] as number) : 1;
  d.run(
    'INSERT INTO llm_providers (id, name, vars, enabled, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, input.name, input.vars ?? '', input.enabled === false ? 0 : 1, sortOrder, now, now],
  );
  save();
  return { id, name: input.name, vars: input.vars ?? '', enabled: input.enabled !== false, sort_order: sortOrder, created_at: now, updated_at: now };
}

/** 更新(vars 为 undefined = 不动;显式传字符串则整体替换) */
export function updateLlmProvider(id: string, updates: { name?: string; vars?: string; enabled?: boolean }): LlmProviderRow {
  const existing = getLlmProvider(id);
  if (!existing) throw new Error(`供应商 ${id} 不存在`);
  const merged = {
    ...existing,
    name: updates.name ?? existing.name,
    vars: updates.vars ?? existing.vars,
    enabled: updates.enabled ?? existing.enabled,
    updated_at: Date.now(),
  };
  ensureDb().run(
    'UPDATE llm_providers SET name=?, vars=?, enabled=?, updated_at=? WHERE id=?',
    [merged.name, merged.vars, merged.enabled ? 1 : 0, merged.updated_at, id],
  );
  save();
  return merged;
}

export function deleteLlmProvider(id: string): void {
  ensureDb().run('DELETE FROM llm_providers WHERE id = ?', [id]);
  save();
}

export function getLlmActive(): LlmActive | null {
  return getSetting<LlmActive | null>('llmActive', null);
}

export function setLlmActive(providerId: string | null): void {
  setSetting('llmActive', { providerId, updatedAt: Date.now() });
}
