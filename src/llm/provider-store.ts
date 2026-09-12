// ── LLM 供应商切换(模型)────────────────────────────────────
//   定义:全局库 llm_providers 表(一段 KEY=VALUE 文本 = 一套供应商,含 Key,勿进 git)
//   激活:settings 表 'llmActive'({providerId|null})
//   物化:~/.code-panel/active-llm.sh(原子全量重写)+ shell rc 独立 managed 块 source
//        + ~/.claude/settings.json env 块受管键同步(settings.json 优先级高于 shell export,
//          不同步这步会被旧配置静默压掉 —— 官方文档明确)
//   选用即「全量重写」,无残留、幂等;「不注入」= 空脚本 + settings.json 删受管键。

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listLlmProviders,
  getLlmProvider,
  getLlmActive,
  setLlmActive,
  getSetting,
  setSetting,
  type LlmProviderRow,
} from '../db/global-store';
import { globalDataFile, globalDataDir } from '../paths';
import { esc, ensureRcMount, rcMounted, shellRcPath } from '../utils/shell-rc';

const RC_TOP = '# >>> code-panel llm (managed) >>>';
const RC_BOT = '# <<< code-panel llm <<<';
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 值里含这些字样的键视为敏感(出参脱敏;回显含 **** 的值保存时保留旧值) */
const SENSITIVE_RE = /TOKEN|KEY|SECRET|PASSWORD/i;

// ── vars 解析 ───────────────────────────────────────────

export interface VarEntry { key: string; value: string }

/** 行式 KEY=VALUE → 有序条目。容忍 `export ` 前缀、首尾引号、空行、# 注释;非法 KEY 抛错带行号 */
export function parseVars(text: string): VarEntry[] {
  const out: VarEntry[] = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawNo = i + 1;
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) throw new Error(`第 ${rawNo} 行不是合法的 KEY=VALUE:${lines[i].trim().slice(0, 60)}`);
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!KEY_RE.test(key)) throw new Error(`第 ${rawNo} 行变量名不合法(${key}):只允许字母/数字/下划线且不以数字开头`);
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out.push({ key, value });
  }
  return out;
}

/** 值形如 `<...>` = 模板占位符(还没填真值),导出时跳过、UI 上提示用户填写 */
export function isPlaceholder(value: string): boolean {
  return /^\s*<[^<>]*>\s*$/.test(String(value ?? ''));
}

/** 脱敏回显:敏感键的值 → `****+尾4位`;占位符原样(它不是真 Key);其余行原样 */
export function maskVarsText(text: string): string {
  return String(text ?? '').split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    let body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf('=');
    if (eq <= 0) return line;
    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim();
    if (!SENSITIVE_RE.test(key)) return `${key}=${value}`;
    const bare = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    if (isPlaceholder(bare)) return `${key}=${bare}`;
    return `${key}=****${bare.slice(-4)}`;
  }).join('\n');
}

/** 未填写的占位符键名列表(激活前防呆:这些行不会被导出) */
export function unfilledKeys(vars: string): string[] {
  try {
    return parseVars(vars).filter(e => isPlaceholder(e.value)).map(e => e.key);
  } catch {
    return [];
  }
}

/** 明文读取(仅超管接口用;UI 点👁 时拉取) */
export function revealProviderVars(id: string): string {
  const p = getLlmProvider(id);
  if (!p) throw new Error(`供应商 ${id} 不存在`);
  return p.vars;
}

/** PUT 合并:新文本里值含 `****` 的行 = 脱敏回显未被编辑 → 保留旧值,防固化 */
export function mergeMaskedVars(newText: string, oldText: string): string {
  let old: VarEntry[] = [];
  try { old = parseVars(oldText); } catch { /* 旧数据坏了就当没有 */ }
  const oldMap = new Map(old.map(e => [e.key, e.value]));
  return String(newText ?? '').split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (value.includes('****') && oldMap.has(key)) {
      const prefix = trimmed.startsWith('export ') ? 'export ' : '';
      return `${prefix}${key}=${oldMap.get(key)}`;
    }
    return line;
  }).join('\n');
}

// ── 物化脚本 ────────────────────────────────────────────

/** 生成 active-llm.sh 内容;provider=null = 「不注入」空档(仅注释,不写 unset 防误伤) */
export function buildLlmScript(p: LlmProviderRow | null): string {
  const when = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines: string[] = [];
  lines.push('# ============================================================');
  lines.push('# code-panel LLM 供应商 — 「模型」选用自动生成,勿手改(含 Key 勿外传)');
  if (p) {
    lines.push(`#   供应商 : ${p.name}(${p.id})    ${when}`);
    lines.push('#   生效   : 已被 shell rc source + 同步 ~/.claude/settings.json → 新终端 claude 即用');
    lines.push('#   切换   : code-panel 右上「模型」,或 ⚙ 配置 → 模型');
    lines.push('# ============================================================');
    const all = parseVars(p.vars);
    const entries = all.filter(e => !isPlaceholder(e.value));   // 未填的占位符不导出(否则字面量会写坏配置)
    for (const { key, value } of entries) {
      lines.push(`export ${key}=${esc(value)}`);
    }
    if (!all.length) lines.push('# (该供应商未配置任何变量)');
    else if (entries.length < all.length) lines.push(`# (略过 ${all.length - entries.length} 行未填写的占位符 —— 请在面板填写)`);
  } else {
    lines.push(`#   状态   : 未启用第三方供应商    ${when}`);
    lines.push('#   说明   : claude 走官方登录态;切回供应商请在面板右上「模型」选择');
    lines.push('# ============================================================');
  }
  lines.push('');
  return lines.join('\n');
}



/** 物化(原子全量重写)active-llm.sh + 确保 rc 挂载;文件 0600(含 Key) */
export function materializeLlm(p: LlmProviderRow | null): string {
  const dir = globalDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = globalDataFile('active-llm.sh');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buildLlmScript(p), 'utf8');
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
  ensureRcMount(RC_TOP, RC_BOT, globalDataFile('active-llm.sh'));
  return file;
}

/** 确保 shell rc 挂载 active-llm.sh(兼容旧名,转调共享工具) */
export function ensureLlmRcMount(): { rc: string; added: boolean } {
  return ensureRcMount(RC_TOP, RC_BOT, globalDataFile('active-llm.sh'));
}

// ── ~/.claude/settings.json 受管键同步 ──────────────────

function claudeSettingsFile(): string {
  const dir = (process.env.CLAUDE_CONFIG_DIR || '').trim() || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

function settingsManifest(): string[] {
  return getSetting<string[]>('llmSettingsManifest', []);
}

/**
 * 把供应商 vars 同步进 ~/.claude/settings.json 的 env 块(受管键合并,其余键绝不碰)。
 * p=null → 按 manifest 精确删键(恢复官方登录态)。
 * 返回 foreignKeys:环境里存在但不受面板管的 ANTHROPIC_ 或 CLAUDE_CODE_ 前缀键
 * (可能压过面板配置,仅提示不改)。
 */
export function syncSettingsJson(p: LlmProviderRow | null): { file: string; synced: boolean; foreignKeys: string[] } {
  const file = claudeSettingsFile();
  let doc: { env?: Record<string, string> } = {};
  if (fs.existsSync(file)) {
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { env?: Record<string, string> };
    } catch (e) {
      // 坏 JSON 绝不覆盖(会丢用户其他配置)——直接报错让人工处理
      throw new Error(`${file} 不是合法 JSON,请先手工修复后再切换供应商: ${(e as Error).message}`);
    }
  }
  if (typeof doc.env !== 'object' || doc.env === null) doc.env = {};

  const union = new Set<string>(settingsManifest());
  for (const row of listLlmProviders()) {
    try { for (const e of parseVars(row.vars)) union.add(e.key); } catch { /* 坏行跳过 */ }
  }

  const activeEntries = p ? parseVars(p.vars).filter(e => !isPlaceholder(e.value)) : [];
  const activeKeys = new Set(activeEntries.map(e => e.key));
  const env = doc.env as Record<string, string>;
  let changed = false;
  if (p) {
    for (const { key, value } of activeEntries) {
      if (env[key] !== value) { env[key] = value; changed = true; }
    }
  }
  for (const key of union) {
    if (!activeKeys.has(key) && key in env) { delete env[key]; changed = true; }
  }
  const manifest = p ? [...activeKeys] : [];
  if (JSON.stringify(settingsManifest()) !== JSON.stringify(manifest)) {
    setSetting('llmSettingsManifest', manifest);
    changed = true;
  }
  if (changed && (p || fs.existsSync(file))) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  }
  const foreignKeys = Object.keys(env)
    .filter(k => /^(ANTHROPIC_|CLAUDE_CODE_)/.test(k) && !activeKeys.has(k) && !union.has(k));
  return { file, synced: changed, foreignKeys };
}

// ── 注入 / 快照 ─────────────────────────────────────────

/** 当前激活供应商的 env 对象(供 ttyd spawn 注入);未激活/异常 → {} 不注入 */
export function readLlmProviderEnv(): Record<string, string> {
  try {
    const active = getLlmActive();
    if (!active?.providerId) return {};
    const p = getLlmProvider(active.providerId);
    if (!p || !p.enabled) return {};
    const out: Record<string, string> = {};
    for (const { key, value } of parseVars(p.vars)) {
      if (!isPlaceholder(value)) out[key] = value;   // 未填的占位符不注入
    }
    return out;
  } catch (e) {
    console.warn('[llm] 读取激活供应商变量失败,跳过注入:', (e as Error).message);
    return {};
  }
}

/** 变量行(结构化,供前端一张卡片一张表单渲染) */
export interface VarsEntryView {
  key: string;
  /** 脱敏后的值(敏感值 → ****尾4;占位符原样保留) */
  value: string;
  /** 敏感键(含 TOKEN/KEY/SECRET/PASSWORD):前端用密码框 + 👁 */
  sensitive: boolean;
  /** 还是模板占位符 <...>,没填真值 */
  unfilled: boolean;
}

export interface SafeLlmProvider {
  id: string;
  name: string;
  vars: string;          // 已脱敏(敏感值 → ****尾4)
  entries: VarsEntryView[];
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  varCount: number;
  baseUrl: string;       // 从 vars 提取,便于列表展示
  tokenTail: string;     // 敏感值脱敏展示(如 sk-****abcd → ****abcd)
  unfilledKeys: string[];// 未填写的占位符键名(激活会被后端拦下)
}

function toSafeProvider(p: LlmProviderRow): SafeLlmProvider {
  let entries: VarEntry[] = [];
  try { entries = parseVars(p.vars); } catch { /* 坏行让编辑时暴露 */ }
  const baseUrl = entries.find(e => e.key === 'ANTHROPIC_BASE_URL')?.value ?? '';
  const token = entries.find(e => SENSITIVE_RE.test(e.key) && e.value && !isPlaceholder(e.value))?.value ?? '';
  return {
    id: p.id,
    name: p.name,
    vars: maskVarsText(p.vars),
    entries: entries.map(e => ({
      key: e.key,
      value: SENSITIVE_RE.test(e.key) && !isPlaceholder(e.value) ? `****${e.value.slice(-4)}` : e.value,
      sensitive: SENSITIVE_RE.test(e.key),
      unfilled: isPlaceholder(e.value),
    })),
    enabled: p.enabled,
    sortOrder: p.sort_order,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    varCount: entries.length,
    baseUrl,
    tokenTail: token ? `****${token.slice(-4)}` : '',
    unfilledKeys: entries.filter(e => isPlaceholder(e.value)).map(e => e.key),
  };
}

export interface LlmSnapshot {
  providers: SafeLlmProvider[];
  active: { providerId: string | null; name: string | null };
  envFile: string;
  rc: string;
  rcMounted: boolean;
  settingsFile: string;
  /** settings.json 里存在但不受面板管的第三方键(可能压过面板配置) */
  foreignKeys: string[];
}

export function llmSnapshot(): LlmSnapshot {
  const providers = listLlmProviders();
  const activeRec = getLlmActive();
  const activeProvider = (activeRec?.providerId ? providers.find(x => x.id === activeRec.providerId) : undefined) ?? null;
  // 同步态:不动盘,只报告(settings.json 同步只发生在 activate/update/delete 时点)
  const activeRow = activeProvider ?? null;
  const foreignKeys = scanForeignKeys();
  return {
    providers: providers.map(toSafeProvider),
    active: { providerId: activeProvider?.id ?? null, name: activeProvider?.name ?? null },
    envFile: globalDataFile('active-llm.sh'),
    rc: shellRcPath(),
    rcMounted: rcMounted(RC_TOP),
    settingsFile: claudeSettingsFile(),
    foreignKeys,
  };
}

/** 只读扫描 settings.json 里的「不受管」第三方键(不写盘) */
function scanForeignKeys(): string[] {
  try {
    const doc = JSON.parse(fs.readFileSync(claudeSettingsFile(), 'utf8')) as { env?: Record<string, string> };
    const env = doc.env;
    if (!env || typeof env !== 'object') return [];
    const union = new Set<string>(settingsManifest());
    for (const row of listLlmProviders()) {
      try { for (const e of parseVars(row.vars)) union.add(e.key); } catch { /* ignore */ }
    }
    return Object.keys(env).filter(k => /^(ANTHROPIC_|CLAUDE_CODE_)/.test(k) && !union.has(k));
  } catch {
    return [];
  }
}

/** 激活某供应商(或 null=不注入):写库 + 物化脚本 + 同步 settings.json,返回快照 */
export function activateLlmProvider(providerId: string | null): LlmSnapshot {
  let row: LlmProviderRow | null = null;
  if (providerId) {
    row = getLlmProvider(providerId) ?? null;
    if (!row) throw new Error(`供应商不存在: ${providerId}`);
    if (!row.enabled) throw new Error(`供应商「${row.name}」已停用,请先启用再使用`);
    const unfilled = unfilledKeys(row.vars);
    if (unfilled.length) {
      throw new Error(`供应商「${row.name}」还有未填写的项:${unfilled.join('、')} —— 请先在 ⚙ 配置 → 模型 里填写`);
    }
  }
  // 写激活态 → 物化脚本 → 同步 settings.json(受管键合并)
  setLlmActive(row?.id ?? null);
  materializeLlm(row);
  syncSettingsJson(row);
  return llmSnapshot();
}
