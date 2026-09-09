// ── 本机免密通道(AI Token)─────────────────────────────
//   ~/.code-panel/ai-token(0600,启动时自动生成,128bit)—— 持有该文件
//   = 本机用户 = 面板主人,直接以超管身份访问全部 API(含安全模式直通)。
//   边界:文件权限即安全边界;远程/外网没有这个文件,照常登录 + 安全模式拦截。
//   吊销:删除文件重启面板即重新生成。

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { globalDataDir } from '../paths';

export const AI_USERNAME = '__ai__';

function aiTokenPath(): string {
  return path.join(globalDataDir(), 'ai-token');
}

/** 读或生成本机 ai-token(幂等;0600,原子写) */
export function ensureAiToken(): string {
  const file = aiTokenPath();
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch { /* 不存在 → 生成 */ }
  const dir = globalDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');   // 128bit
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, token + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  console.log('[AI] 本机免密 token 已生成:', file, '(0600)');
  return token;
}

/** 常量时间比较(防逐字节探测) */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 请求是否带有效 ai-token(Authorization: Bearer) */
export function hasValidAiToken(req: Request): boolean {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return false;
  const presented = h.slice(7).trim();
  if (!presented || presented.length < 32) return false;
  return safeEqual(presented, ensureAiToken());
}
