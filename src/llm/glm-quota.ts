// ── 智谱 GLM Coding Plan 额度查询(服务端代理)───────────────
//   官方接口:GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
//   ⚠️ 官方接口鉴权失败也回 HTTP 200,成败必须看 body.code===200 && success(防钓鱼同源校验见 README)。
//   key 来源:llm_providers 里 BASE_URL 含 open.bigmodel.cn 的供应商的 ANTHROPIC_AUTH_TOKEN
//   (优先当前生效项,其次启用的第一家);key 只在服务端使用,响应里绝不回传。

import { listLlmProviders, getLlmActive } from '../db/global-store';
import { parseVars, isPlaceholder } from './provider-store';

/** 一个额度池(5小时/一周);percent = 已用百分比 0-100 */
export interface GlmQuotaPool {
  key: string;        // '5h' | 'week' | fallback 原始 unit
  label: string;      // '5小时' | '一周' | 'unit N'
  used: number;
  total: number;
  remaining: number;
  percent: number;    // 已用 %
  resetAt: number;    // 重置时间戳(ms)
}

export interface GlmQuotaData {
  providerId: string;
  providerName: string;
  level: string;      // 套餐等级(lite/pro/max...)
  pools: GlmQuotaPool[];
  fetchedAt: number;
}

const QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';

/** 从明文 vars 提取智谱 Key(找智谱供应商用;拿不到返回 '') */
function extractToken(vars: string): string {
  const e = parseVars(vars).find(x => x.key === 'ANTHROPIC_AUTH_TOKEN');
  const v = (e?.value ?? '').trim();
  return v && !isPlaceholder(v) ? v : '';
}

/** 挑选用来查额度的供应商:BASE_URL 指向 bigmodel 且 Key 已填;优先当前生效项 */
function pickGlmProvider(): { id: string; name: string; token: string } | null {
  const activeId = getLlmActive()?.providerId ?? null;
  const all = listLlmProviders()
    .map(p => {
      const baseUrl = parseVars(p.vars).find(x => x.key === 'ANTHROPIC_BASE_URL')?.value ?? '';
      return { id: p.id, name: p.name, baseUrl, token: extractToken(p.vars), enabled: p.enabled };
    })
    .filter(p => p.enabled && /bigmodel\.cn/i.test(p.baseUrl) && p.token);
  return all.find(p => p.id === activeId) ?? all[0] ?? null;
}

/** unit → 语义标签(unit=3 number=5 → 5小时窗口;unit=6 number=1 → 一周窗口) */
function poolLabel(unit: number): { key: string; label: string } {
  if (unit === 3) return { key: '5h', label: '5小时' };
  if (unit === 6) return { key: 'week', label: '一周' };
  return { key: `unit${unit}`, label: `unit ${unit}` };
}

/** 查询智谱 Coding Plan 剩余额度;无可用供应商/上游失败抛带文案的 Error */
export async function fetchGlmQuota(): Promise<GlmQuotaData> {
  const p = pickGlmProvider();
  if (!p) throw new Error('未找到已填 Key 的智谱供应商(需 BASE_URL 含 open.bigmodel.cn 且已填 ANTHROPIC_AUTH_TOKEN)');

  const res = await fetch(QUOTA_URL, {
    headers: {
      Authorization: p.token,
      'Accept-Language': 'zh-CN,zh',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  });
  const body = await res.json().catch(() => null) as
    | { code?: number; msg?: string; success?: boolean; data?: { limits?: Record<string, unknown>[]; level?: unknown } }
    | null;
  // 官方坑:错误也回 HTTP 200,必须看 body
  if (!body || body.code !== 200 || body.success !== true) {
    throw new Error(`智谱接口返回失败:${body?.msg || `HTTP ${res.status}`}`);
  }

  const pools: GlmQuotaPool[] = (body.data?.limits ?? [])
    .map((raw: Record<string, unknown>) => {
      const unit = Number(raw.unit ?? -1);
      const { key, label } = poolLabel(unit);
      const total = Number(raw.usage ?? 0);
      const used = Number(raw.currentValue ?? 0);
      const remaining = Number(raw.remaining ?? Math.max(total - used, 0));
      return {
        key, label,
        used, total, remaining,
        percent: Math.min(100, Math.max(0, Number(raw.percentage ?? (total ? (used / total) * 100 : 0)))),
        resetAt: Number(raw.nextResetTime ?? 0),
      };
    })
    // 展示顺序固定:5小时在上、一周在下,其余未知类型殿后
    .sort((a, b) => ({ '5h': 0, week: 1 }[a.key] ?? 9) - ({ '5h': 0, week: 1 }[b.key] ?? 9));

  if (!pools.length) throw new Error('智谱接口返回了空额度数据');

  return {
    providerId: p.id,
    providerName: p.name,
    level: String(body.data?.level ?? ''),
    pools,
    fetchedAt: Date.now(),
  };
}
