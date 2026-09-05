// ── 命令抽屉:系统预设(全局常量) + 自定义命令(随项目 .code-panel/commands.yaml) ──
//   commands.yaml 为提交式模块文件(随仓库走,AI/人照模板加);系统预设仍是面板常量。

import crypto from 'crypto';
import type { ProjectRow } from '../db/global-store';
import { loadProjectModule, saveProjectModule } from '../projects/project-store';
import type { CommandsModuleYaml } from '../projects/yaml';

export interface CommandButton {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  subgroup?: string;
  type: 'system' | 'custom';
}

/** 系统预设命令 —— 全局常量,不随项目、不入文件 */
export const SYSTEM_PRESETS: CommandButton[] = [
  { id: 'sys-disk', label: '磁盘空间', command: 'df -h', type: 'system' },
  { id: 'sys-disk-capacity', label: '磁盘容量详情', command: 'df -h /', type: 'system' },
  { id: 'sys-memory', label: '内存使用', command: 'free -h', type: 'system' },
  { id: 'sys-cpu', label: 'CPU 信息', command: 'lscpu | head -20', type: 'system' },
  { id: 'sys-network', label: '网络连接', command: 'ss -tlnp', type: 'system' },
  { id: 'sys-process', label: '进程列表', command: 'ps aux --sort=-%mem | head -20', type: 'system' },
  { id: 'sys-uptime', label: '系统负载', command: 'uptime', type: 'system' },
  { id: 'sys-io', label: '磁盘 IO', command: 'iostat -x 1 3', type: 'system' },
];

type StoredCommand = { id: string; label: string; command: string; cwd?: string; subgroup?: string };

function readCustom(project: ProjectRow): StoredCommand[] {
  const yaml = loadProjectModule(project, 'commands') as CommandsModuleYaml;
  return (yaml?.commands || []).filter(c => c && c.id && c.command);
}

function writeCustom(project: ProjectRow, list: StoredCommand[]): void {
  saveProjectModule(project, 'commands', { commands: list });
}

/** 该项目的自定义命令 */
export function getCustomCommands(project: ProjectRow): CommandButton[] {
  return readCustom(project).map(c => ({ ...c, type: 'custom' as const }));
}

/** 全部命令 = 系统预设 + 该项目自定义 */
export function getAllCommands(project: ProjectRow): CommandButton[] {
  return [...SYSTEM_PRESETS, ...getCustomCommands(project)];
}

export function addCommand(
  project: ProjectRow,
  fields: { label: string; command: string; cwd?: string; subgroup?: string },
): CommandButton {
  const entry: StoredCommand = {
    id: crypto.randomUUID(),
    label: fields.label.trim(),
    command: fields.command.trim(),
    cwd: fields.cwd?.trim() || undefined,
    subgroup: fields.subgroup?.trim() || undefined,
  };
  const list = readCustom(project);
  list.push(entry);
  writeCustom(project, list);
  return { ...entry, type: 'custom' };
}

export function deleteCommand(project: ProjectRow, id: string): boolean {
  if (SYSTEM_PRESETS.some(c => c.id === id)) return false;
  const list = readCustom(project);
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  writeCustom(project, list);
  return true;
}

export function updateCommand(
  project: ProjectRow,
  id: string,
  fields: { label?: string; command?: string; cwd?: string; subgroup?: string },
): CommandButton | null {
  if (SYSTEM_PRESETS.some(c => c.id === id)) return null;
  const list = readCustom(project);
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return null;
  const cmd = list[idx];
  if (fields.label !== undefined) cmd.label = fields.label.trim();
  if (fields.command !== undefined) cmd.command = fields.command.trim();
  if (fields.cwd !== undefined) cmd.cwd = fields.cwd?.trim() || undefined;
  if (fields.subgroup !== undefined) cmd.subgroup = fields.subgroup?.trim() || undefined;
  writeCustom(project, list);
  return { ...cmd, type: 'custom' };
}

/** 重排自定义命令(仅该项目的 custom;系统预设恒在最前) */
export function reorderCommands(project: ProjectRow, ids: string[]): boolean {
  const list = readCustom(project);
  const map = new Map(list.map(c => [c.id, c]));
  const reordered: StoredCommand[] = [];
  for (const id of ids) {
    const c = map.get(id);
    if (c) { reordered.push(c); map.delete(id); }
  }
  for (const c of map.values()) reordered.push(c);
  writeCustom(project, reordered);
  return true;
}
