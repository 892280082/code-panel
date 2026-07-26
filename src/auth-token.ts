// ── Security token — random code required for review mode toggle ──

import crypto from 'crypto';

/** 启动时生成，重启后刷新 */
export const REVIEW_TOKEN = crypto.randomBytes(4).toString('hex'); // 8 位 hex

/** 校验令牌 */
export function checkToken(token: unknown): boolean {
  return typeof token === 'string' && token === REVIEW_TOKEN;
}
