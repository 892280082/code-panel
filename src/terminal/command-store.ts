import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CommandButton {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  type: 'system' | 'custom';
  group?: string;       // 所属分组，为空时表示全局命令
  createdAt: string;
  updatedAt: string;
}

const DATA_FILE = path.resolve(process.cwd(), 'data/terminal-commands.json');

const SYSTEM_PRESETS: Omit<CommandButton, 'createdAt' | 'updatedAt'>[] = [
  { id: 'sys-disk', label: '磁盘空间', command: 'df -h', type: 'system' },
  { id: 'sys-disk-capacity', label: '磁盘容量详情', command: 'df -h /', type: 'system' },
  { id: 'sys-memory', label: '内存使用', command: 'free -h', type: 'system' },
  { id: 'sys-cpu', label: 'CPU 信息', command: 'lscpu | head -20', type: 'system' },
  { id: 'sys-network', label: '网络连接', command: 'ss -tlnp', type: 'system' },
  { id: 'sys-process', label: '进程列表', command: 'ps aux --sort=-%mem | head -20', type: 'system' },
  { id: 'sys-uptime', label: '系统负载', command: 'uptime', type: 'system' },
  { id: 'sys-io', label: '磁盘 IO', command: 'iostat -x 1 3', type: 'system' },
];

function seedSystemPresets(existing: CommandButton[]): CommandButton[] {
  const now = new Date().toISOString();
  const existingIds = new Set(existing.map(c => c.id));
  const existingLabels = new Set(existing.map(c => c.label));
  const presets: CommandButton[] = [];
  for (const p of SYSTEM_PRESETS) {
    if (!existingIds.has(p.id) && !existingLabels.has(p.label)) {
      presets.push({ ...p, createdAt: now, updatedAt: now });
    }
  }
  if (presets.length > 0) {
    const systemCmds = existing.filter(c => c.type === 'system');
    const customCmds = existing.filter(c => c.type === 'custom');
    return [...systemCmds, ...presets, ...customCmds];
  }
  return existing;
}

function readFile(): CommandButton[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const migrated = parsed.map((c: any) => ({ ...c, type: c.type || 'custom' }));
    const seeded = seedSystemPresets(migrated);
    if (seeded !== migrated) writeFile(seeded);
    return seeded;
  } catch {
    return [];
  }
}

function writeFile(commands: CommandButton[]): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(commands, null, 2), 'utf-8');
}

/** 获取所有命令，可按 group 筛选 */
export function getAllCommands(group?: string): CommandButton[] {
  const all = readFile();
  if (!group) return all;
  // system 命令全局可见，custom 命令仅所属分组可见
  return all.filter(c => c.type === 'system' || c.group === group);
}

export function addCommand(label: string, command: string, cwd?: string, group?: string, type: 'system' | 'custom' = 'custom'): CommandButton {
  const commands = readFile();
  const now = new Date().toISOString();
  const entry: CommandButton = {
    id: crypto.randomUUID(),
    label: label.trim(),
    command: command.trim(),
    cwd: cwd?.trim() || undefined,
    type,
    group: group?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  commands.push(entry);
  writeFile(commands);
  return entry;
}

export function deleteCommand(id: string): boolean {
  const commands = readFile();
  const idx = commands.findIndex(c => c.id === id);
  if (idx === -1) return false;
  if (commands[idx].type === 'system') return false;
  commands.splice(idx, 1);
  writeFile(commands);
  return true;
}

export function updateCommand(id: string, fields: { label?: string; command?: string; cwd?: string; group?: string }): CommandButton | null {
  const commands = readFile();
  const idx = commands.findIndex(c => c.id === id);
  if (idx === -1) return null;
  const cmd = commands[idx];
  if (cmd.type === 'system') return null;
  if (fields.label !== undefined) cmd.label = fields.label.trim();
  if (fields.command !== undefined) cmd.command = fields.command.trim();
  if (fields.cwd !== undefined) cmd.cwd = fields.cwd?.trim() || undefined;
  if (fields.group !== undefined) cmd.group = fields.group?.trim() || undefined;
  cmd.updatedAt = new Date().toISOString();
  commands[idx] = cmd;
  writeFile(commands);
  return cmd;
}

export function reorderCommands(ids: string[], group?: string): boolean {
  const commands = readFile();
  const systemCmds = commands.filter(c => c.type === 'system');
  const customCmds = group
    ? commands.filter(c => c.type === 'custom' && c.group === group)
    : commands.filter(c => c.type === 'custom');
  const customMap = new Map(customCmds.map(c => [c.id, c]));
  const reordered: CommandButton[] = [];
  for (const id of ids) {
    const c = customMap.get(id);
    if (c) { reordered.push(c); customMap.delete(id); }
  }
  for (const c of customMap.values()) reordered.push(c);

  // 拼接：保留其它分组的 custom 命令不变
  const otherCustom = group
    ? commands.filter(c => c.type === 'custom' && c.group !== group)
    : [];
  const all = [...systemCmds, ...reordered, ...otherCustom];
  writeFile(all);
  return true;
}
