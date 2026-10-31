// ── 项目模块 YAML 的通用「读改写」适配器 + 模块专属读取 ──
//   sql.yaml→connections / git.yaml→repos 都是顶层数组,用同一套 upsert/delete;
//   logs.yaml 的 sections 需要平铺读取;prd 完成状态走 data/prd-status.json。

import os from 'os';
import path from 'path';
import type { ProjectRow } from '../db/global-store';
import type { DbConnection, RedisConnection } from '../types';
import type {
  ModuleName, SqlModuleYaml, GitModuleYaml, LogsModuleYaml, PrdModuleYaml,
} from './yaml';
import { loadProjectModule, saveProjectModule, readRuntimeJson, writeRuntimeJson } from './project-store';
import { projectEnvVars, interpolateEnvVars } from '../env/env-store';

// 模块 yaml 的顶层数组字段名(sql→connections, git→repos, redis→connections)
const ARRAY_KEY: Partial<Record<ModuleName, string>> = { sql: 'connections', git: 'repos', redis: 'connections' };

type ArrayModule = 'sql' | 'git' | 'redis';

/** 读取模块顶层数组(sql/git) */
export function listModuleItems<T>(project: ProjectRow, module: ArrayModule): T[] {
  const key = ARRAY_KEY[module] as string;
  const yaml = loadProjectModule(project, module) as Record<string, unknown>;
  return (yaml?.[key] ?? []) as T[];
}

/** 按 keyField 找到顶层数组中一项(找不到返回 undefined) */
/**
 * upsert 顶层数组项:存在则合并更新,不存在则追加。
 * keyField 通常为 'id'。写后整文件落盘。
 */
export function upsertProjectList<T extends { id: string }>(
  project: ProjectRow, module: ArrayModule, keyField: string, id: string, item: T,
): T {
  const key = ARRAY_KEY[module] as string;
  const yaml = loadProjectModule(project, module, { raw: true }) as Record<string, T[]>;   // 写盘用原始,防固化占位符
  const arr = (yaml?.[key] ?? []) as Array<T & Record<string, unknown>>;
  const idx = arr.findIndex(x => x?.[keyField] === id);
  const merged = { ...(idx >= 0 ? arr[idx] : {}), ...item, [keyField]: id } as T & Record<string, unknown>;
  if (idx >= 0) arr[idx] = merged;
  else arr.push(merged);
  saveProjectModule(project, module, { ...yaml, [key]: arr } as ModuleYamlLike);
  return merged as T;
}

/** 删除顶层数组项;返回是否删到 */
export function deleteProjectListItem(
  project: ProjectRow, module: ArrayModule, keyField: string, id: string,
): boolean {
  const key = ARRAY_KEY[module] as string;
  const yaml = loadProjectModule(project, module, { raw: true }) as Record<string, unknown[]>;   // 写盘用原始,防固化占位符
  const arr = (yaml?.[key] ?? []) as Array<Record<string, unknown>>;
  const idx = arr.findIndex(x => x?.[keyField] === id);
  if (idx < 0) return false;
  arr.splice(idx, 1);
  saveProjectModule(project, module, { ...yaml, [key]: arr } as ModuleYamlLike);
  return true;
}

// 便于调用方直接读写数组(避免触碰上面泛型)
type ModuleYamlLike = SqlModuleYaml | GitModuleYaml | LogsModuleYaml | PrdModuleYaml;

/** sqlite 路径里的 ~ 展开为当前用户家目录(写盘仍保留原始值) */
function expandHome<T extends { type?: string; path?: string }>(c: T): T {
  if (c.type === 'sqlite' && typeof c.path === 'string' && (c.path === '~' || c.path.startsWith('~/'))) {
    return { ...c, path: path.join(os.homedir(), c.path.slice(2)) };
  }
  return c;
}

/** sql.yaml:本项目连接列表 */
export function sqlConnections(project: ProjectRow): DbConnection[] {
  const raw = listModuleItems<DbConnection>(project, 'sql');
  // ${VAR:default} 占位符按项目当前环境组插值(仅读入内存;写盘走原始读取,防固化)
  const list = interpolateEnvVars(raw, projectEnvVars(project)) as DbConnection[];
  return list.map(expandHome);
}

/** sql.yaml:按 id 取连接(已插值,连库/展示用) */
export function sqlConnection(project: ProjectRow, id: string): DbConnection | undefined {
  return sqlConnections(project).find(c => c.id === id);
}

/** sql.yaml:按 id 取原始连接(未插值;PUT 合并等写路径用,防占位符固化进 yaml) */
export function sqlConnectionRaw(project: ProjectRow, id: string): DbConnection | undefined {
  return listModuleItems<DbConnection>(project, 'sql').find(c => c.id === id);
}

// ── redis.yaml(连接读取;插值/raw 语义与 sql 一致) ──

export function redisConnections(project: ProjectRow): RedisConnection[] {
  const raw = listModuleItems<RedisConnection>(project, 'redis');
  return interpolateEnvVars(raw, projectEnvVars(project)) as RedisConnection[];
}

export function redisConnection(project: ProjectRow, id: string): RedisConnection | undefined {
  return redisConnections(project).find(c => c.id === id);
}

export function redisConnectionRaw(project: ProjectRow, id: string): RedisConnection | undefined {
  return listModuleItems<RedisConnection>(project, 'redis').find(c => c.id === id);
}

/** git.yaml:本项目仓库列表 */
export function gitRepos(project: ProjectRow): { id: string; name: string; path: string; notes?: string }[] {
  return listModuleItems(project, 'git');
}

/** git.yaml:按 string id 取仓库 */
// ── logs.yaml 专属:把 sections 平铺成条目(section 名带上) ──

export interface FlatLogEntry {
  name: string;
  file: string;
  port?: number;
  start?: string;
  stop?: string;
  /** 平台/分组名(新平台式 / 旧 sections 均用它做 UI 分组) */
  platform: string;
  /** 前端/后端 等边标(可选;platforms 式才有) */
  side?: string;
}

export function logsFlatEntries(project: ProjectRow): FlatLogEntry[] {
  const yaml = loadProjectModule(project, 'logs') as LogsModuleYaml;
  const out: FlatLogEntry[] = [];
  // 新平台式:platforms:[{name, backend:[], frontend:[]}]
  if (Array.isArray((yaml as any).platforms)) {
    for (const p of (yaml as any).platforms) {
      for (const l of p?.backend ?? []) out.push({ name: l.name, file: l.file, port: l.port, start: l.start, stop: l.stop, platform: p.name, side: '后端' });
      for (const l of p?.frontend ?? []) out.push({ name: l.name, file: l.file, port: l.port, start: l.start, stop: l.stop, platform: p.name, side: '前端' });
    }
    return out;
  }
  // 旧 sections 平铺(向后兼容):分组名=section 名
  for (const sec of yaml?.sections ?? []) {
    for (const l of sec?.logs ?? []) {
      out.push({ name: l.name, file: l.file, port: l.port, start: l.start, stop: l.stop, platform: sec.name });
    }
  }
  return out;
}

/** 某文件是否属于该项目的 logs.yaml(供 content/clear 校验) */
export function isProjectLogFile(project: ProjectRow, file: string): boolean {
  return logsFlatEntries(project).some(l => l.file === file);
}

// ── PRD 完成状态:<root>/.code-panel/data/prd-status.json ──
//    存成 map:{ [dir]: done }。目录路径做 key。

export function prdDoneGet(project: ProjectRow): Record<string, boolean> {
  return readRuntimeJson<Record<string, boolean>>(project, 'prd-status.json', {});
}

export function prdDoneSet(project: ProjectRow, dir: string, done: boolean): void {
  const map = prdDoneGet(project);
  map[dir] = done;
  writeRuntimeJson(project, 'prd-status.json', map);
}
