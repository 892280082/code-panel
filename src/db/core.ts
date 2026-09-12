// ── 全局库底层句柄(四域拆分的公共底座)──────────────────
//   db 单例 / ensureDb / save(落盘) / sha256;
//   初始化(initGlobalStore)在 global-store.ts,经 setDb 注入。

import type { Database as SqlJsDb } from 'sql.js';
import crypto from 'crypto';
import fs from 'fs';
import { GLOBAL_DB_PATH } from '../paths';

let db: SqlJsDb | null = null;

/** initGlobalStore 装载/建库后注入 */
export function setDb(d: SqlJsDb): void {
  db = d;
}

export function ensureDb(): SqlJsDb {
  if (!db) throw new Error('global-store not initialized — call initGlobalStore() first');
  return db;
}

export function save(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(GLOBAL_DB_PATH, Buffer.from(data));
}

/** sha256 hex(与 fork/config.json credentials 兼容) */
export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
