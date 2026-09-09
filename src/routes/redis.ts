// ── Redis 管理路由(查看缓存 / 清缓存;作用域 ?project=;信封 {ok,data|error})──
//   只读(INFO/SCAN/详情)直接执行;危险操作(FLUSH/批量删)reviewMode 下进审批队列,
//   OFF 时直执行 —— 语义与 SQL 一致;全部操作落 data/redis-history.json。

import { Router, Request, Response } from 'express';
import type { ProjectRow } from '../db/global-store';
import type { RedisJobPayload, RedisConnection } from '../types';
import { requireProject } from '../projects/context';
import {
  redisConnections, redisConnection, redisConnectionRaw,
  upsertProjectList, deleteProjectListItem,
} from '../projects/adapters';
import { getRedisClient, invalidateRedisClient } from '../db/redis-client';
import {
  fetchInfo, fetchConfigExtras, scanKeys, fetchKeyDetail,
  setTtl, deleteKeys, collectKeysByMatch,
} from '../redis/redis-ops';
import { getConfig } from '../config-manager';
import { queueAdd } from '../projects/sql-store';
import { readRuntimeJson, writeRuntimeJson } from '../projects/project-store';
import { getHealthStatus } from '../db/health-check';

const router = Router();

function reqProject(req: Request): ProjectRow {
  return (req as Request & { project: ProjectRow }).project;
}

// ── 操作历史(项目 data/redis-history.json;上限 200) ──

interface RedisHistoryEntry {
  id: string; connId: string; db?: number;
  action: string; target?: string; count?: number;
  result: string; executedAt: number; via?: 'direct' | 'review';
}

function pushHistory(project: ProjectRow, entry: Omit<RedisHistoryEntry, 'id' | 'executedAt'>): void {
  const list = readRuntimeJson<RedisHistoryEntry[]>(project, 'redis-history.json', []);
  list.unshift({ ...entry, id: `rh-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, executedAt: Date.now() });
  writeRuntimeJson(project, 'redis-history.json', list.slice(0, 200));
}

// ── 危险操作公共逻辑:reviewMode → 进队列;OFF → 直执行 ──

interface DangerResult { queued: boolean; jobId?: string; affected?: number }

async function runDanger(
  project: ProjectRow, connId: string, payload: RedisJobPayload,
  title: string, display: string, direct: () => Promise<number>,
): Promise<DangerResult> {
  const cfg = getConfig();
  if (cfg.reviewMode) {
    // reviewMode ON:进审批队列(kind=redis),去 /sql 页审批后执行
    const job = queueAdd(project, { sql: display, reason: title, dbId: connId, title, kind: 'redis', redis: payload });
    return { queued: true, jobId: job.id };
  }
  const affected = await direct();
  pushHistory(project, { connId, db: payload.db, action: payload.action, target: payload.match, count: affected, result: 'ok', via: 'direct' });
  return { queued: false, affected };
}

function mustConn(project: ProjectRow, id: string): RedisConnection {
  const conn = redisConnection(project, id);
  if (!conn) throw new Error(`Redis 连接 "${id}" 不存在`);
  return conn;
}

function mustClient(project: ProjectRow, conn: RedisConnection, db?: number) {
  return getRedisClient(project.id, conn.id, {
    host: conn.host, port: conn.port, password: conn.password,
    db: db ?? conn.db,
  });
}

// ── 连接 CRUD(照 databases.ts 形状) ─────────────────────

router.get('/api/redis', requireProject, (req, res) => {
  const project = reqProject(req);
  const list = redisConnections(project).map(c => {
    const { password, ...rest } = c;
    const health = getHealthStatus(project.id, c.id);
    return { ...rest, hasPassword: !!password, alive: health?.alive ?? false, version: health?.serverVersion ?? null, healthError: health?.error ?? null };
  });
  res.json({ ok: true, data: list });
});

router.post('/api/redis', requireProject, (req, res) => {
  try {
    const project = reqProject(req);
    const conn = (req.body ?? {}) as RedisConnection;
    if (!conn.id || !conn.name) return res.status(400).json({ ok: false, error: 'id, name are required' });
    if (redisConnection(project, conn.id)) return res.status(400).json({ ok: false, error: `Redis "${conn.id}" 已存在` });
    upsertProjectList<RedisConnection>(project, 'redis', 'id', conn.id, conn);
    res.json({ ok: true, data: conn });
  } catch (e) { res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

router.put('/api/redis/:id', requireProject, (req, res) => {
  try {
    const project = reqProject(req);
    const id = String(req.params.id);
    const existing = redisConnectionRaw(project, id);   // 原始未插值,防占位符固化
    if (!existing) return res.status(404).json({ ok: false, error: `Redis "${id}" not found` });
    upsertProjectList<RedisConnection>(project, 'redis', 'id', id, { ...existing, ...(req.body ?? {}) } as RedisConnection);
    void invalidateRedisClient(project.id, id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

router.delete('/api/redis/:id', requireProject, (req, res) => {
  try {
    const project = reqProject(req);
    const deleted = deleteProjectListItem(project, 'redis', 'id', String(req.params.id));
    if (!deleted) return res.status(404).json({ ok: false, error: `Redis "${req.params.id}" not found` });
    void invalidateRedisClient(project.id, String(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

// ── 概览 ────────────────────────────────────────────────

router.get('/api/redis/:id/info', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const db = req.query.db ? Number(req.query.db) : undefined;
    const client = mustClient(project, conn, db);
    const [info, extras] = await Promise.all([fetchInfo(client), fetchConfigExtras(client)]);
    info.clients.max = extras.maxClients;
    info.memory.policy = extras.policy;
    info.maxDatabases = extras.maxDatabases;
    res.json({ ok: true, data: info });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

// ── key 浏览 / 详情 ─────────────────────────────────────

router.get('/api/redis/:id/keys', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const client = mustClient(project, conn, req.query.db ? Number(req.query.db) : undefined);
    const out = await scanKeys(client, {
      cursor: String(req.query.cursor ?? '0'),
      match: req.query.match ? String(req.query.match) : '*',
      count: req.query.count ? Number(req.query.count) : 100,
    });
    res.json({ ok: true, data: out });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

router.get('/api/redis/:id/key', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const key = String(req.query.key ?? '');
    if (!key) return res.status(400).json({ ok: false, error: 'key is required' });
    const client = mustClient(project, conn, req.query.db ? Number(req.query.db) : undefined);
    res.json({ ok: true, data: await fetchKeyDetail(client, key) });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

// ── TTL / 删除 ──────────────────────────────────────────

router.post('/api/redis/:id/ttl', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const { db, key, ttl } = (req.body ?? {}) as { db?: number; key?: string; ttl?: number };
    if (!key || typeof ttl !== 'number') return res.status(400).json({ ok: false, error: 'key, ttl are required' });
    const client = mustClient(project, conn, db);
    await setTtl(client, key, ttl);
    pushHistory(project, { connId: conn.id, db, action: 'ttl', target: key, result: ttl < 0 ? 'persist' : `${ttl}s`, via: 'direct' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

router.delete('/api/redis/:id/key', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const { db, key } = (req.body ?? {}) as { db?: number; key?: string };
    if (!key) return res.status(400).json({ ok: false, error: 'key is required' });
    const client = mustClient(project, conn, db);
    const n = await deleteKeys(client, [key]);
    pushHistory(project, { connId: conn.id, db, action: 'delete-key', target: key, count: n, result: 'ok', via: 'direct' });
    res.json({ ok: true, data: { deleted: n } });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

// ── 危险操作(reviewMode 管控) ──────────────────────────

/** 批量删:body {db, keys?[], match?, limit?} — keys 直删(≤500),match 走审批模式删除 */
router.post('/api/redis/:id/keys/delete', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const { db, keys, match, limit } = (req.body ?? {}) as { db?: number; keys?: string[]; match?: string; limit?: number };
    if (match) {
      if (match.trim() === '*') return res.status(400).json({ ok: false, error: '禁止裸 * 模式删除(全清请用 FLUSHDB)' });
      const client = mustClient(project, conn, db);
      const collected = await collectKeysByMatch(client, match, limit ?? 2000);
      const out = await runDanger(
        project, conn.id,
        { connId: conn.id, db, action: 'delete-keys', match, limit },
        `按模式删除 Redis key(match=${match})`,
        `DEL ${collected.length} keys @ ${conn.id}/db${db ?? conn.db ?? 0} match "${match}"`,
        () => deleteKeys(client, collected),
      );
      return res.json({ ok: true, data: { ...out, matched: collected.length } });
    }
    if (!Array.isArray(keys) || !keys.length) return res.status(400).json({ ok: false, error: 'keys or match is required' });
    if (keys.length > 500) return res.status(400).json({ ok: false, error: '批量删除上限 500 个 key' });
    const client = mustClient(project, conn, db);
    const out = await runDanger(
      project, conn.id,
      { connId: conn.id, db, action: 'delete-keys', keys },
      `批量删除 Redis key(${keys.length} 个)`,
      `DEL ${keys.length} keys @ ${conn.id}/db${db ?? conn.db ?? 0}`,
      () => deleteKeys(client, keys),
    );
    res.json({ ok: true, data: out });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

router.post('/api/redis/:id/flushdb', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const { db, confirm } = (req.body ?? {}) as { db?: number; confirm?: string };
    if (confirm !== 'FLUSHDB') return res.status(400).json({ ok: false, error: 'confirm 必须为 "FLUSHDB"' });
    const client = mustClient(project, conn, db);
    const out = await runDanger(
      project, conn.id,
      { connId: conn.id, db, action: 'flushdb' },
      `清空 Redis db ${db ?? conn.db ?? 0}(${conn.name})`,
      `FLUSHDB @ ${conn.id}/db${db ?? conn.db ?? 0}`,
      () => client.flushdb().then(() => 1),
    );
    res.json({ ok: true, data: out });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

router.post('/api/redis/:id/flushall', requireProject, async (req, res) => {
  try {
    const project = reqProject(req);
    const conn = mustConn(project, String(req.params.id));
    const { confirm } = (req.body ?? {}) as { confirm?: string };
    if (confirm !== 'FLUSHALL') return res.status(400).json({ ok: false, error: 'confirm 必须为 "FLUSHALL"' });
    const client = mustClient(project, conn);
    const out = await runDanger(
      project, conn.id,
      { connId: conn.id, action: 'flushall' },
      `清空 Redis 整实例(${conn.name})`,
      `FLUSHALL @ ${conn.id}`,
      () => client.flushall().then(() => 1),
    );
    res.json({ ok: true, data: out });
  } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
});

// ── 历史 ────────────────────────────────────────────────

router.get('/api/redis/:id/history', requireProject, (req, res) => {
  const project = reqProject(req);
  res.json({ ok: true, data: readRuntimeJson<RedisHistoryEntry[]>(project, 'redis-history.json', []).slice(0, 50) });
});

export default router;
