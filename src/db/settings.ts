// ── settings 表(面板级公共配置:key-value,JSON 值)───────
//   reviewMode / capsule / backup / llmActive 等都在这里。

import { ensureDb, save } from './core';

export function hasSetting(key: string): boolean {
  const d = ensureDb();
  const stmt = d.prepare('SELECT 1 FROM settings WHERE key = ?');
  stmt.bind([key]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

export function getSetting<T>(key: string, fallback: T): T {
  const d = ensureDb();
  const stmt = d.prepare('SELECT value FROM settings WHERE key = ?');
  stmt.bind([key]);
  let value = fallback;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    try { value = JSON.parse(row.value as string) as T; } catch { value = fallback; }
  }
  stmt.free();
  return value;
}

export function setSetting(key: string, value: unknown): void {
  ensureDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
  save();
}
