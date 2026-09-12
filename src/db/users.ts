// ── users 表 + user_projects 分配 ────────────────────────
//   账号 CRUD / 口令校验 / 用户→项目授权。

import { ensureDb, save, sha256 } from './core';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  /** superadmin(超管,见全部项目) | user(普通,只见被分配项目) */
  role: string;
  created_at: number;
  updated_at: number;
}

export interface SafeUser {
  id: number;
  username: string;
  role: string;
  created_at: number;
}

export function insertUserRaw(username: string, passwordHash: string, role = 'superadmin'): void {
  const now = Date.now();
  ensureDb().run(
    'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?)',
    [username, passwordHash, role, now, now],
  );
  save();
}

export function countUsers(): number {
  const d = ensureDb();
  const r = d.exec('SELECT COUNT(*) AS n FROM users');
  return r.length ? (r[0].values[0][0] as number) : 0;
}

export function listUsersSafe(): SafeUser[] {
  const d = ensureDb();
  const r = d.exec('SELECT id, username, role, created_at FROM users ORDER BY id');
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => { o[c] = row[i]; });
    return {
      id: o.id as number,
      username: o.username as string,
      role: (o.role as string) || 'user',
      created_at: o.created_at as number,
    };
  });
}

export function findUser(username: string): UserRow | undefined {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM users WHERE username = ?');
  stmt.bind([username]);
  let row: UserRow | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, unknown>;
    row = {
      id: o.id as number,
      username: o.username as string,
      password_hash: o.password_hash as string,
      role: (o.role as string) || 'user',
      created_at: o.created_at as number,
      updated_at: o.updated_at as number,
    };
  }
  stmt.free();
  return row;
}

export function verifyUser(username: string, password: string): boolean {
  const user = findUser(username);
  if (!user) return false;
  return sha256(password) === user.password_hash;
}

/** 加一个账号(明文密码→sha256;role: superadmin | user,默认普通用户) */
export function addUser(username: string, password: string, role = 'user'): void {
  if (findUser(username)) throw new Error(`用户 ${username} 已存在`);
  insertUserRaw(username, sha256(password), role);
}

export function updatePassword(username: string, newPlainPassword: string): void {
  ensureDb().run(
    'UPDATE users SET password_hash=?, updated_at=? WHERE username=?',
    [sha256(newPlainPassword), Date.now(), username],
  );
  save();
}

/** 删除账号(连同其项目分配) */
export function deleteUser(username: string): void {
  ensureDb().run('DELETE FROM users WHERE username = ?', [username]);
  ensureDb().run('DELETE FROM user_projects WHERE username = ?', [username]);
  save();
}

// ── 用户 · 项目分配(user_projects)──────────────────────

/** 用户被分配的项目 id 列表 */
export function listUserProjectIds(username: string): string[] {
  const d = ensureDb();
  const r = d.exec('SELECT project_id FROM user_projects WHERE username = ? ORDER BY project_id', [username]);
  if (!r.length) return [];
  return r[0].values.map(v => v[0] as string);
}

/** 全量重写用户的项目分配 */
export function setUserProjects(username: string, projectIds: string[]): void {
  const d = ensureDb();
  d.run('DELETE FROM user_projects WHERE username = ?', [username]);
  for (const pid of projectIds) {
    d.run('INSERT OR IGNORE INTO user_projects (username, project_id) VALUES (?,?)', [username, pid]);
  }
  save();
}
