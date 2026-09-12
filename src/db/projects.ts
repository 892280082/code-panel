// ── projects 注册表 + project_env(项目→当前环境组)───────

import { ensureDb, save } from './core';
import { findUser } from './users';

export interface ProjectRow {
  id: string;
  name: string;
  root: string;
  note?: string;
  created_at: number;
  updated_at: number;
}

export function listProjects(): ProjectRow[] {
  const d = ensureDb();
  const r = d.exec('SELECT * FROM projects ORDER BY created_at');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return {
      id: o.id as string,
      name: o.name as string,
      root: o.root as string,
      note: o.note ? (o.note as string) : '',
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  });
}

export function getProject(id: string): ProjectRow | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM projects WHERE id = ?');
  stmt.bind([id]);
  let row: ProjectRow | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    row = {
      id: o.id as string,
      name: o.name as string,
      root: o.root as string,
      note: o.note ? (o.note as string) : '',
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  }
  stmt.free();
  return row;
}

export function addProject(id: string, name: string, root: string, note = ''): ProjectRow {
  const d = ensureDb();
  if (getProject(id)) throw new Error(`项目 ${id} 已存在`);
  const now = Date.now();
  d.run(
    'INSERT INTO projects (id, name, root, note, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [id, name, root, note, now, now],
  );
  save();
  return { id, name, root, note, created_at: now, updated_at: now };
}

export function updateProject(id: string, updates: { name?: string; root?: string; note?: string }): ProjectRow {
  const existing = getProject(id);
  if (!existing) throw new Error(`项目 ${id} 不存在`);
  const merged = {
    ...existing,
    name: updates.name ?? existing.name,
    root: updates.root ?? existing.root,
    note: updates.note ?? existing.note ?? '',
    updated_at: Date.now(),
  };
  ensureDb().run(
    'UPDATE projects SET name=?, root=?, note=?, updated_at=? WHERE id=?',
    [merged.name, merged.root, merged.note, merged.updated_at, id],
  );
  save();
  return merged;
}

export function deleteProject(id: string): void {
  ensureDb().run('DELETE FROM projects WHERE id = ?', [id]);
  ensureDb().run('DELETE FROM user_projects WHERE project_id = ?', [id]); // 清理分配关联
  save();
}

/** 按用户可见性列项目:超管 → 全部;普通用户 → 仅被分配的 */
export function listProjectsForUser(username: string): ProjectRow[] {
  const user = findUser(username);
  if (!user || user.role === 'superadmin') return listProjects();
  const d = ensureDb();
  const r = d.exec(
    `SELECT p.* FROM projects p
     JOIN user_projects up ON up.project_id = p.id AND up.username = ?
     ORDER BY p.created_at`,
    [username],
  );
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return {
      id: o.id as string,
      name: o.name as string,
      root: o.root as string,
      note: o.note ? (o.note as string) : '',
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  });
}

// ── 项目 · 环境组选择(project_env)—— 记录「项目 → 当前环境组」──────

export interface ProjectEnvSelection {
  projectId: string;
  groupId: string;
  /** user = 手动选用;default = 默认组兜底自动记录 */
  source: 'user' | 'default';
  updatedAt: number;
}

export function getProjectEnvSelection(projectId: string): ProjectEnvSelection | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM project_env WHERE project_id = ?');
  stmt.bind([projectId]);
  let row: ProjectEnvSelection | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    row = {
      projectId: o.project_id as string,
      groupId: o.group_id as string,
      source: (o.source as 'user' | 'default') || 'user',
      updatedAt: (o.updated_at as number) || 0,
    };
  }
  stmt.free();
  return row;
}

export function setProjectEnvSelection(
  projectId: string,
  groupId: string,
  source: 'user' | 'default' = 'user',
): void {
  ensureDb().run(
    `INSERT INTO project_env (project_id, group_id, source, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET group_id = excluded.group_id,
       source = excluded.source, updated_at = excluded.updated_at`,
    [projectId, groupId, source, Date.now()],
  );
  save();
}

export function clearProjectEnvSelection(projectId: string): void {
  ensureDb().run('DELETE FROM project_env WHERE project_id = ?', [projectId]);
  save();
}
