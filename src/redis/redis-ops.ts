// ── Redis 操作集(INFO 解析 / SCAN 分页 / key 详情 / TTL·DEL·FLUSH 执行器)──
//   全部走 ioredis 客户端(getRedisClient);SCAN 游标分页,禁用 KEYS。

import type Redis from 'ioredis';
import { ensureRedisClient } from '../db/redis-client';
import { errorMessage } from '../utils/route-utils';

// ── INFO 解析 ────────────────────────────────────────────

function parseInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf(':');
    if (i > 0) out[s.slice(0, i)] = s.slice(i + 1);
  }
  return out;
}

export interface RedisInfoSummary {
  version: string;
  os: string;
  role: string;
  uptimeDays: number;
  clients: { connected: number; blocked: number; max: number };
  memory: {
    usedBytes: number; usedHuman: string;
    maxBytes: number; maxHuman: string;   // 0 = 无上限
    peakBytes: number;
    fragmentationRatio: number;
    policy: string;
  };
  hitRate: { hits: number; misses: number; rate: number };
  opsPerSec: number;
  evictedKeys: number;
  keyspace: { db: number; keys: number; expires: number; avgTtlMs: number }[];
  maxDatabases: number;
  rdbLastSaveTs: number;
  aofEnabled: number;
}

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)}${units[i]}`;
}

/** 概览:一次拉齐 INFO + 关键 CONFIG,解析成前端零解析的结构体 */
export async function fetchInfo(client: Redis): Promise<RedisInfoSummary> {
  const [infoText, cfg, keyspaceText] = await Promise.all([
    client.info(),
    client.config('GET', 'maxmemory').then((r: string[]) => r[1] ?? '0').catch(() => '0'),
    client.info('keyspace').catch(() => ''),
  ]);
  const s = parseInfo(infoText);
  // keyspace 段行形如 db50:keys=123,expires=45,avg_ttl=60000 → parseInfo 直接切分
  const keyspace = parseInfo(keyspaceText);

  const num = (v: string | undefined) => Number(v ?? 0) || 0;
  const hits = num(s.keyspace_hits), misses = num(s.keyspace_misses);
  const maxmemory = num(cfg);

  const ks: RedisInfoSummary['keyspace'] = [];
  for (const [k, v] of Object.entries(keyspace)) {
    const m = /^db(\d+)$/.exec(k);
    if (!m) continue;
    const part = Object.fromEntries((v.match(/(\w+)=([\d.]+)/g) || []).map(x => x.split('=') as [string, string]));
    ks.push({ db: Number(m[1]), keys: num(part.keys), expires: num(part.expires), avgTtlMs: Math.round(num(part.avg_ttl)) });
  }
  ks.sort((a, b) => a.db - b.db);

  return {
    version: s.redis_version || '?',
    os: s.os || '?',
    role: s.role || '?',
    uptimeDays: Math.floor(num(s.uptime_in_seconds) / 86400),
    clients: {
      connected: num(s.connected_clients),
      blocked: num(s.blocked_clients),
      max: 0, // 由路由层补(CONFIG maxclients)
    },
    memory: {
      usedBytes: num(s.used_memory),
      usedHuman: s.used_memory_human || humanBytes(num(s.used_memory)),
      maxBytes: maxmemory,
      maxHuman: maxmemory > 0 ? humanBytes(maxmemory) : '无上限',
      peakBytes: num(s.used_memory_peak),
      fragmentationRatio: num(s.mem_fragmentation_ratio),
      policy: 'unknown', // 由路由层补
    },
    hitRate: { hits, misses, rate: hits + misses > 0 ? Math.round(hits / (hits + misses) * 1000) / 10 : 0 },
    opsPerSec: num(s.instantaneous_ops_per_sec),
    evictedKeys: num(s.evicted_keys),
    keyspace: ks,
    maxDatabases: 16, // 路由层补
    rdbLastSaveTs: num(s.rdb_last_save_time),
    aofEnabled: num(s.aof_enabled),
  };
}

/** 补充 CONFIG 类字段(maxclients/policy/databases) */
export async function fetchConfigExtras(client: Redis): Promise<{ maxClients: number; policy: string; maxDatabases: number }> {
  try {
    const r = await client.config('GET', 'maxclients', 'maxmemory-policy', 'databases') as string[];
    const map: Record<string, string> = {};
    for (let i = 0; i < r.length; i += 2) map[r[i]] = r[i + 1];
    return { maxClients: Number(map.maxclients ?? 0) || 0, policy: map['maxmemory-policy'] ?? 'unknown', maxDatabases: Number(map.databases ?? 16) || 16 };
  } catch {
    return { maxClients: 0, policy: 'unknown', maxDatabases: 16 };
  }
}

// ── SCAN 分页 + 批量元数据 ───────────────────────────────

export interface RedisKeyMeta { key: string; type: string; ttlMs: number; sizeBytes: number | null }

/** SCAN 游标分页;每 key PIPELINE 取 TYPE/PTTL/MEMORY USAGE */
export async function scanKeys(
  client: Redis, opts: { cursor: string; match?: string; count?: number },
): Promise<{ cursor: string; keys: RedisKeyMeta[] }> {
  const count = Math.min(Math.max(opts.count ?? 100, 1), 1000);
  const [nextCursor, keys] = await client.scan(
    Number(opts.cursor || 0), 'MATCH', opts.match || '*', 'COUNT', count,
  ) as [string, string[]];

  if (!keys.length) return { cursor: nextCursor, keys: [] };
  const pipe = client.pipeline();
  for (const k of keys) {
    pipe.type(k);
    pipe.pttl(k);
    pipe.call('MEMORY', 'USAGE', k);
  }
  const results = await pipe.exec() as [Error | null, any][];
  const metas: RedisKeyMeta[] = keys.map((k, i) => {
    const type = results[i * 3]?.[1] ?? 'none';
    const ttl = results[i * 3 + 1]?.[1];
    const size = results[i * 3 + 2]?.[1];
    return {
      key: k,
      type: typeof type === 'string' ? type : 'none',
      ttlMs: typeof ttl === 'number' ? ttl : -2,
      sizeBytes: typeof size === 'number' ? size : null,
    };
  });
  return { cursor: nextCursor, keys: metas };
}

// ── key 详情(按类型分发;截断保护) ──────────────────────

const DETAIL_LIMIT = 200;
const VALUE_MAX_BYTES = 64 * 1024;

export interface RedisKeyDetail {
  key: string; type: string; ttlMs: number; encoding: string; sizeBytes: number | null;
  length: number;                    // 集合长度/字符串字节数
  value: unknown; truncated: boolean;
}

export async function fetchKeyDetail(client: Redis, key: string): Promise<RedisKeyDetail> {
  const type = await client.type(key);
  const [ttlMs, encoding, sizeBytes] = await Promise.all([
    client.pttl(key).catch(() => -2),
    client.call('OBJECT', 'ENCODING', key).then(v => String(v)).catch(() => '?'),
    client.call('MEMORY', 'USAGE', key).then(v => (typeof v === 'number' ? v : null)).catch(() => null),
  ]);
  const detail: RedisKeyDetail = { key, type, ttlMs, encoding, sizeBytes, length: 0, value: null, truncated: false };

  if (type === 'string') {
    const v = await client.get(key);
    const buf = Buffer.from(v ?? '', 'utf8');
    detail.length = buf.length;
    if (buf.length > VALUE_MAX_BYTES) { detail.value = buf.subarray(0, VALUE_MAX_BYTES).toString('utf8'); detail.truncated = true; }
    else detail.value = v;
    // 尝试 JSON 美化(成功则替换为对象,前端高亮渲染)
    if (!detail.truncated && typeof detail.value === 'string') {
      try { const j = JSON.parse(detail.value); if (j && typeof j === 'object') detail.value = j; } catch { /* 保持原文 */ }
    }
  } else if (type === 'hash') {
    detail.length = await client.hlen(key);
    const entries = await client.hscan(key, 0, 'COUNT', DETAIL_LIMIT + 1).then(([, ks]) => ks);
    const pairs: Record<string, string> = {};
    for (let i = 0; i < Math.min(entries.length, DETAIL_LIMIT * 2); i += 2) pairs[entries[i]] = entries[i + 1];
    detail.value = pairs; detail.truncated = detail.length > DETAIL_LIMIT;
  } else if (type === 'list') {
    detail.length = await client.llen(key);
    detail.value = await client.lrange(key, 0, DETAIL_LIMIT - 1);
    detail.truncated = detail.length > DETAIL_LIMIT;
  } else if (type === 'set') {
    detail.length = await client.scard(key);
    detail.value = await client.sscan(key, 0, 'COUNT', DETAIL_LIMIT + 1).then(([, ks]) => ks);
    detail.truncated = detail.length > DETAIL_LIMIT;
  } else if (type === 'zset') {
    detail.length = await client.zcard(key);
    detail.value = await client.call('ZRANGE', key, '0', String(DETAIL_LIMIT - 1), 'WITHSCORES');
    detail.truncated = detail.length > DETAIL_LIMIT;
  } else if (type === 'stream') {
    detail.length = await client.xlen(key);
    detail.value = await client.xrange(key, '-', '+', 'COUNT', DETAIL_LIMIT);
    detail.truncated = detail.length > DETAIL_LIMIT;
  } else {
    detail.value = `(不支持预览的类型: ${type})`;
  }
  return detail;
}

// ── TTL / 删除 / 清空 ────────────────────────────────────

export async function setTtl(client: Redis, key: string, ttlSec: number): Promise<void> {
  if (ttlSec < 0) await client.persist(key);
  else await client.expire(key, ttlSec);
}

export async function deleteKeys(client: Redis, keys: string[]): Promise<number> {
  if (!keys.length) return 0;
  return client.del(...keys);
}

/** 按 MATCH 模式收集 key(上限保护;禁止裸 * 全匹配 — 调用方校验) */
export async function collectKeysByMatch(client: Redis, match: string, limit = 2000): Promise<string[]> {
  const out: string[] = [];
  let cursor = 0;
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', match, 'COUNT', 500) as [string, string[]];
    out.push(...keys);
    cursor = Number(next);
  } while (cursor !== 0 && out.length < limit);
  return out.slice(0, limit);
}

/** 健康检查探活:PING + 版本 */
export async function pingVersion(target: { host?: string; port?: number; password?: string; db?: number }): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const client = await ensureRedisClient('__health__', '__health__', target);
    const pong = await client.ping();
    const info = parseInfo(await client.info('server'));
    return { ok: pong === 'PONG', version: info.redis_version };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
