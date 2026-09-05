// ── Git 仓库配置(随项目):<项目根>/.code-panel/git.yaml repos 数组 ──
//   repo id 是稳定 string(slug),不再是旧 sqlite 自增数字;旧 group 字段废弃。

import crypto from 'crypto';
import type { ProjectRow } from '../db/global-store';
import type { GitModuleYaml } from '../projects/yaml';
import { loadProjectModule, saveProjectModule, slugify } from '../projects/project-store';

export interface GitRepo {
  id: string;
  name: string;
  path: string;
  notes?: string;
}

function loadRepos(project: ProjectRow): GitRepo[] {
  const yaml = loadProjectModule(project, 'git') as GitModuleYaml;
  return yaml?.repos ?? [];
}

function saveRepos(project: ProjectRow, repos: GitRepo[]): void {
  saveProjectModule(project, 'git', { repos });
}

/** 生成稳定 id:name slug;若重名则补 3 位随机后缀 */
function genId(project: ProjectRow, name: string): string {
  const base = slugify(name);
  const repos = loadRepos(project);
  if (!repos.some(r => r.id === base)) return base;
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

// ── CRUD(全部带 project) ────────────────────────────────

export function listRepos(project: ProjectRow): GitRepo[] {
  return loadRepos(project);
}

export function getRepo(project: ProjectRow, id: string): GitRepo | undefined {
  return loadRepos(project).find(r => r.id === id);
}

export function addRepo(project: ProjectRow, name: string, repoPath: string, notes?: string, id?: string): GitRepo {
  if (!name || !repoPath) throw new Error('name and path are required');
  const repos = loadRepos(project);
  const repoId = id ?? genId(project, name);
  if (repos.some(r => r.id === repoId)) throw new Error(`Git repo "${repoId}" already exists`);
  const repo: GitRepo = { id: repoId, name, path: repoPath, notes: notes || undefined };
  repos.push(repo);
  saveRepos(project, repos);
  return repo;
}

export function updateRepo(project: ProjectRow, id: string, updates: { name?: string; path?: string; notes?: string }): GitRepo {
  const repos = loadRepos(project);
  const idx = repos.findIndex(r => r.id === id);
  if (idx < 0) throw new Error(`Git repo ${id} not found`);
  // 只合并有值的字段,避免 undefined 覆盖原有值
  const patch: Partial<GitRepo> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.path !== undefined) patch.path = updates.path;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  repos[idx] = { ...repos[idx], ...patch, id };
  saveRepos(project, repos);
  return repos[idx];
}

export function deleteRepo(project: ProjectRow, id: string): boolean {
  const repos = loadRepos(project);
  const idx = repos.findIndex(r => r.id === id);
  if (idx < 0) return false;
  repos.splice(idx, 1);
  saveRepos(project, repos);
  return true;
}
