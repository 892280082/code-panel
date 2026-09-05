// ── 快捷启动链接存储(随项目):<root>/.code-panel/data/launch-links.json ──
//   旧全局 group 字段废弃。

import crypto from 'crypto';
import type { ProjectRow } from '../db/global-store';
import { readRuntimeJson, writeRuntimeJson } from '../projects/project-store';

export interface LaunchLink {
  id: string;
  label: string;
  url: string;
  tag?: string;
  createdAt: string;
  updatedAt: string;
}

function load(project: ProjectRow): LaunchLink[] {
  return readRuntimeJson<LaunchLink[]>(project, 'launch-links.json', []);
}

function save(project: ProjectRow, links: LaunchLink[]): void {
  writeRuntimeJson(project, 'launch-links.json', links);
}

/** 该项目的全部链接 */
export function getAllLinks(project: ProjectRow): LaunchLink[] {
  return load(project);
}

export function addLink(project: ProjectRow, label: string, url: string, tag?: string): LaunchLink {
  const links = load(project);
  const now = new Date().toISOString();
  const entry: LaunchLink = {
    id: crypto.randomUUID(),
    label: label.trim(),
    url: url.trim(),
    tag: tag?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  links.push(entry);
  save(project, links);
  return entry;
}

export function deleteLink(project: ProjectRow, id: string): boolean {
  const links = load(project);
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return false;
  links.splice(idx, 1);
  save(project, links);
  return true;
}

export function updateLink(project: ProjectRow, id: string, fields: { label?: string; url?: string; tag?: string }): LaunchLink | null {
  const links = load(project);
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const link = links[idx];
  if (fields.label !== undefined) link.label = fields.label.trim();
  if (fields.url !== undefined) link.url = fields.url.trim();
  if (fields.tag !== undefined) link.tag = fields.tag?.trim() || undefined;
  link.updatedAt = new Date().toISOString();
  save(project, links);
  return link;
}

/** 重排:ids 为新顺序;未提及的排在后面 */
export function reorderLinks(project: ProjectRow, ids: string[]): boolean {
  const links = load(project);
  const map = new Map(links.map(l => [l.id, l]));
  const reordered: LaunchLink[] = [];
  for (const id of ids) {
    const l = map.get(id);
    if (l) { reordered.push(l); map.delete(id); }
  }
  for (const l of map.values()) reordered.push(l);
  save(project, reordered);
  return true;
}
