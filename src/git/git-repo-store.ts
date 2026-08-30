import { save as saveDb } from '../db/db-config-store';
// ── Git repo config store (same SQLite as db-config) ─────
//   分组字段 group = 日志分组 key（字符串标签，复用日志分组体系）

let _gitDb: import('sql.js').Database | null = null;

export function setGitDb(db: import('sql.js').Database): void {
  _gitDb = db;
}

function db(): import('sql.js').Database {
  if (!_gitDb) throw new Error('git-repo-store: db not open — ensure db-config-store.init() ran first');
  return _gitDb;
}

function lastInsertId(): number {
  const r = db().exec('SELECT last_insert_rowid() AS id');
  return r[0].values[0][0] as number;
}

// ── Init table ───────────────────────────────────────────

export function initGitTable(): void {
  const d = db();
  d.run(`
    CREATE TABLE IF NOT EXISTS git_repos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      path       TEXT NOT NULL,
      notes      TEXT DEFAULT '',
      "group"    TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  // 升级旧表：添加 group 列（如果不存在）
  try { d.run('ALTER TABLE git_repos ADD COLUMN "group" TEXT DEFAULT ""'); } catch { /* 已存在 */ }
  saveDb();
}

// ── CRUD ─────────────────────────────────────────────────

export interface GitRepo {
  id: number;
  name: string;
  path: string;
  notes: string;
  group?: string;
}

export function listRepos(group?: string): GitRepo[] {
  let sql = 'SELECT id, name, path, notes, "group" FROM git_repos';
  const params: string[] = [];
  if (group) { sql += ' WHERE "group" = ?'; params.push(group); }
  sql += ' ORDER BY created_at';
  const r = db().exec(sql, params);
  if (!r.length) return [];
  return r[0].values.map(row => ({
    id: row[0] as number,
    name: row[1] as string,
    path: row[2] as string,
    notes: (row[3] as string) || '',
    group: (row[4] as string) || undefined,
  }));
}

export function getRepo(id: number): GitRepo | undefined {
  const stmt = db().prepare('SELECT id, name, path, notes, "group" FROM git_repos WHERE id = ?');
  stmt.bind([id]);
  let result: GitRepo | undefined;
  if (stmt.step()) {
    const o = stmt.getAsObject();
    result = {
      id: o.id as number,
      name: o.name as string,
      path: o.path as string,
      notes: (o.notes as string) || '',
      group: (o.group as string) || undefined,
    };
  }
  stmt.free();
  return result;
}

export function addRepo(name: string, repoPath: string, notes?: string, group?: string): GitRepo {
  const now = Date.now();
  db().run(
    'INSERT INTO git_repos (name, path, notes, "group", created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [name, repoPath, notes || '', group || '', now, now],
  );
  // 注意: 必须先取 last_insert_rowid 再 saveDb()(export) — sql.js 的 export 会重置 rowid
  const id = lastInsertId();
  saveDb();
  return { id, name, path: repoPath, notes: notes || '', group: group || undefined };
}

export function updateRepo(id: number, updates: { name?: string; path?: string; notes?: string; group?: string }): void {
  const existing = getRepo(id);
  if (!existing) throw new Error(`Git repo ${id} not found`);
  const merged = { ...existing, ...updates };
  db().run(
    'UPDATE git_repos SET name=?, path=?, notes=?, "group"=?, updated_at=? WHERE id=?',
    [merged.name, merged.path, merged.notes, merged.group || '', Date.now(), id],
  );
  saveDb();
}

export function deleteRepo(id: number): void {
  db().run('DELETE FROM git_repos WHERE id = ?', [id]);
  saveDb();
}
