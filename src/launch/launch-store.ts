// ── 快捷启动链接存储:data/launch-links.json ────────────

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface LaunchLink {
  id: string;
  label: string;
  url: string;
  tag?: string;         // 简单标识:如 分组/账号/平台
  group?: string;       // 所属日志分组,为空时表示全局链接
  createdAt: string;
  updatedAt: string;
}

const DATA_FILE = path.resolve(process.cwd(), 'data/launch-links.json');

function readFile(): LaunchLink[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeFile(links: LaunchLink[]): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2), 'utf-8');
}

/** 获取所有链接,可按 group 筛选 */
export function getAllLinks(group?: string): LaunchLink[] {
  const all = readFile();
  if (!group) return all;
  return all.filter(l => l.group === group);
}

export function addLink(label: string, url: string, group?: string, tag?: string): LaunchLink {
  const links = readFile();
  const now = new Date().toISOString();
  const entry: LaunchLink = {
    id: crypto.randomUUID(),
    label: label.trim(),
    url: url.trim(),
    tag: tag?.trim() || undefined,
    group: group?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  links.push(entry);
  writeFile(links);
  return entry;
}

export function deleteLink(id: string): boolean {
  const links = readFile();
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return false;
  links.splice(idx, 1);
  writeFile(links);
  return true;
}

export function updateLink(id: string, fields: { label?: string; url?: string; tag?: string; group?: string }): LaunchLink | null {
  const links = readFile();
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const link = links[idx];
  if (fields.label !== undefined) link.label = fields.label.trim();
  if (fields.url !== undefined) link.url = fields.url.trim();
  if (fields.tag !== undefined) link.tag = fields.tag?.trim() || undefined;
  if (fields.group !== undefined) link.group = fields.group?.trim() || undefined;
  link.updatedAt = new Date().toISOString();
  links[idx] = link;
  writeFile(links);
  return link;
}

/** 重排:ids 为该分组内新顺序,其它分组链接保持原位 */
export function reorderLinks(ids: string[], group?: string): boolean {
  const links = readFile();
  const inGroup = links.filter(l => (group ? l.group === group : !l.group));
  const others = links.filter(l => !(group ? l.group === group : !l.group));

  const map = new Map(inGroup.map(l => [l.id, l]));
  const reordered: LaunchLink[] = [];
  for (const id of ids) {
    const l = map.get(id);
    if (l) { reordered.push(l); map.delete(id); }
  }
  for (const l of map.values()) reordered.push(l);

  // 拼接:目标分组链接(重排后)在前,其余链接保持原顺序在后
  writeFile([...reordered, ...others]);
  return true;
}
