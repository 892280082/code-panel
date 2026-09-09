// ── 环境变量组 / 全局环境(env)──────────────────────────────
//   组定义:<项目根>/.code-panel/envs.yaml(提交式,随仓库走)
//   当前环境物化:全局 ~/.code-panel/active-env.sh(被 shell rc source → 新终端全局生效)
//   项目→当前组记录:全局库 project_env(见 global-store)
//   规则:项目没设置过 → 自动用 envs.yaml 里 default:true 的组兜底(记录 source=default)
//   选用即「全量重写」active-env.sh,无残留、幂等。

import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import type { ProjectRow } from '../db/global-store';
import {
  getProjectEnvSelection,
  setProjectEnvSelection,
  clearProjectEnvSelection,
} from '../db/global-store';
import { projectCodePanelDir, globalDataFile, globalDataDir } from '../paths';

export interface EnvGroup {
  id: string;
  name: string;
  default?: boolean;
  vars: Record<string, string>;
}

export interface EnvCurrent {
  groupId: string;
  name: string;
  source: 'user' | 'default';
  vars: Record<string, string>;
}

export interface EnvSnapshot {
  groups: EnvGroup[];
  current: EnvCurrent | null;
  hasYaml: boolean;
  envFile: string;
  rc: string;
  rcMounted: boolean;
  /** active-env.sh 里 CODE_PANEL_* 变量数(审计口径) */
  varsUsed: number;
}

const RC_TOP = '# >>> code-panel env (managed) >>>';
const RC_BOT = '# <<< code-panel env <<<';

export function envsYamlFile(root: string): string {
  return path.join(projectCodePanelDir(root), 'envs.yaml');
}

export function loadEnvGroups(root: string): EnvGroup[] {
  const f = envsYamlFile(root);
  if (!fs.existsSync(f)) return [];
  try {
    const doc = yaml.load(fs.readFileSync(f, 'utf8')) as { groups?: unknown } | null;
    if (!doc || !Array.isArray(doc.groups)) return [];
    return (doc.groups as any[])
      .filter((g) => g && typeof g === 'object')
      .map((g) => {
        const vars: Record<string, string> = {};
        if (g.vars && typeof g.vars === 'object') {
          for (const [k, v] of Object.entries(g.vars as Record<string, unknown>)) {
            if (typeof v === 'string' || typeof v === 'number') vars[k] = String(v);
          }
        }
        return {
          id: typeof g.id === 'string' && g.id.trim() ? g.id.trim() : '',
          name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : '',
          default: g.default === true,
          vars,
        };
      })
      .filter((g) => g.id);
  } catch (e) {
    console.warn(`[env] 读取 envs.yaml 失败回退空(${f}):`, (e as Error).message);
    return [];
  }
}

export function groupById(groups: EnvGroup[], id: string): EnvGroup | undefined {
  return groups.find((g) => g.id === id);
}

/** 项目当前生效组的变量(组 vars 覆盖进程 env),供模块 yaml 的 ${VAR:default} 占位符插值 */
export function projectEnvVars(project: ProjectRow): Record<string, string> {
  const groups = loadEnvGroups(project.root);
  const sel = getProjectEnvSelection(project.id);
  const g = (sel ? groupById(groups, sel.groupId) : undefined) ?? defaultGroup(groups);
  return { ...process.env, ...(g?.vars ?? {}) } as Record<string, string>;
}

/**
 * 递归展开值里的 ${VAR} / ${VAR:default} 占位符(仅字符串;对象/数组深遍历)。
 * VAR 未设:有 default 用 default,否则保留原样(不静默吞,便于发现问题)。
 * 只用于「读入内存」,任何写盘路径不得使用,防占位符被固化进 yaml。
 */
export function interpolateEnvVars(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g, (raw, name: string, def?: string) => {
      const v = vars[name];
      if (v !== undefined && v !== '') return v;
      return def !== undefined ? def : raw;
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolateEnvVars(v, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateEnvVars(v, vars);
    }
    return out;
  }
  return value;
}

function defaultGroup(groups: EnvGroup[]): EnvGroup | undefined {
  return groups.find((g) => g.default);
}

function esc(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** 生成物化脚本(注释头 + 按前缀分组 export,排版对齐) */
export function buildEnvScript(project: ProjectRow, group: EnvGroup): string {
  const when = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines: string[] = [];
  lines.push('# ============================================================');
  lines.push('# code-panel 当前环境变量 — 「环境组」选用自动生成,一般勿手改');
  lines.push(`#   来源项目: ${project.name || project.id}`);
  lines.push(`#   环境组  : ${group.name || group.id}(${group.id})    ${when}`);
  lines.push('#   生效    : 已被 shell rc source → 新开终端即带');
  lines.push('#   切换    : code-panel 右上「环境」选用,或改项目 .code-panel/envs.yaml');
  lines.push('# ============================================================');
  const entries = Object.entries(group.vars || {});
  let curCat: string | null = null;
  for (const [k, v] of entries) {
    const parts = k.split('_');
    const cat = parts.length >= 2 ? parts.slice(0, 2).join('_') : k;
    if (cat !== curCat) {
      lines.push(`# --- ${cat} ---`);
      curCat = cat;
    }
    lines.push(`export ${k}=${esc(v)}`);
  }
  if (!entries.length) lines.push('# (空环境组:无变量)');
  lines.push('');
  return lines.join('\n');
}

/** 物化(原子全量重写)active-env.sh */
export function writeActiveEnv(project: ProjectRow, group: EnvGroup): string {
  const dir = globalDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = globalDataFile('active-env.sh');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buildEnvScript(project, group), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** 读全局 active-env.sh 里已 export 的变量(供 ttyd 等 spawn 注入;bash 不 source ~/.zshrc,必须显式带) */
export function readActiveEnvVars(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const content = fs.readFileSync(globalDataFile('active-env.sh'), 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      out[m[1]] = v;
    }
  } catch {
    /* 无文件则空 */
  }
  return out;
}

function shellRcPath(): string {
  const env = (process.env.CODE_PANEL_RC || '').trim();
  if (env) return env;
  const home = os.homedir();
  for (const c of ['.zshrc', '.bashrc', '.bash_profile', '.profile']) {
    const cand = path.join(home, c);
    if (fs.existsSync(cand)) return cand;
  }
  return path.join(home, '.zshrc');
}

/** 确保 shell rc 有 source 挂载(幂等:带起止标记,存在即跳过) */
export function ensureShellRcMount(): { rc: string; added: boolean } {
  const rc = shellRcPath();
  const envFile = globalDataFile('active-env.sh');
  let content = '';
  try {
    content = fs.readFileSync(rc, 'utf8');
  } catch {
    /* rc 缺失则新建 */
  }
  if (content.includes(RC_TOP)) return { rc, added: false };
  const block = `\n${RC_TOP}\n[ -f "${envFile}" ] && source "${envFile}"\n${RC_BOT}\n`;
  fs.writeFileSync(rc, content.replace(/\n?$/, '\n') + block, 'utf8');
  return { rc, added: true };
}

function rcMounted(): boolean {
  try {
    return fs.readFileSync(shellRcPath(), 'utf8').includes(RC_TOP);
  } catch {
    return false;
  }
}

function envFileVarsUsed(): number {
  try {
    const content = fs.readFileSync(globalDataFile('active-env.sh'), 'utf8');
    return (content.match(/^\s*export\s+(CODE_PANEL_[A-Z0-9_]+)/gm) || []).length;
  } catch {
    return 0;
  }
}

/** 只读快照:当前 = DB 记录有效则用之;否则默认组(仅呈现,不落库) */
export function envSnapshot(project: ProjectRow): EnvSnapshot {
  const groups = loadEnvGroups(project.root);
  const hasYaml = fs.existsSync(envsYamlFile(project.root));
  const sel = getProjectEnvSelection(project.id);
  let current: EnvCurrent | null = null;
  if (sel) {
    const g = groupById(groups, sel.groupId);
    if (g) current = { groupId: g.id, name: g.name || g.id, source: sel.source, vars: g.vars };
  }
  if (!current) {
    const def = defaultGroup(groups);
    if (def) current = { groupId: def.id, name: def.name || def.id, source: 'default', vars: def.vars };
  }
  return {
    groups,
    current,
    hasYaml,
    envFile: globalDataFile('active-env.sh'),
    rc: shellRcPath(),
    rcMounted: rcMounted(),
    varsUsed: envFileVarsUsed(),
  };
}

/** 把某组物化到全局文件并确保 rc 挂载 */
function materialize(project: ProjectRow, group: EnvGroup): void {
  writeActiveEnv(project, group);
  ensureShellRcMount();
}

/**
 * 「打开项目」兜底:项目没设过(或记录已失效)→ 自动落到 default 组并记库(source=default)。
 * 用户不配置也能起程序(默认组即兜底)。返回是否发生了兜底。
 */
export function ensureEnv(project: ProjectRow): { changed: boolean; current: EnvSnapshot['current'] } {
  const groups = loadEnvGroups(project.root);
  const sel = getProjectEnvSelection(project.id);
  const selGroup = sel ? groupById(groups, sel.groupId) : undefined;
  if (selGroup) {
    materialize(project, selGroup);
    return {
      changed: false,
      current: { groupId: selGroup.id, name: selGroup.name || selGroup.id, source: sel.source, vars: selGroup.vars },
    };
  }
  const def = defaultGroup(groups);
  if (def) {
    setProjectEnvSelection(project.id, def.id, 'default');
    materialize(project, def);
    return {
      changed: true,
      current: { groupId: def.id, name: def.name || def.id, source: 'default', vars: def.vars },
    };
  }
  return { changed: false, current: null };
}

/** 手动选用某组:写库(source=user)+ 物化 + 确保挂载 */
export function activateEnv(project: ProjectRow, groupId: string): EnvSnapshot {
  const groups = loadEnvGroups(project.root);
  const g = groupById(groups, groupId);
  if (!g) throw new Error(`环境组不存在: ${groupId}`);
  setProjectEnvSelection(project.id, g.id, 'user');
  materialize(project, g);
  return envSnapshot(project);
}

/** 清除手动设置 → 回落到默认组(无默认则仅清记录) */
export function resetEnv(project: ProjectRow): EnvSnapshot {
  clearProjectEnvSelection(project.id);
  const groups = loadEnvGroups(project.root);
  const def = defaultGroup(groups);
  if (def) {
    setProjectEnvSelection(project.id, def.id, 'default');
    materialize(project, def);
  }
  return envSnapshot(project);
}
