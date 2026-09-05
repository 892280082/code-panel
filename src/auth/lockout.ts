// ── Login failure lockout ─────────────────────────────────
//   内存记录失败次数,14 次后锁定,重启清零

const MAX_ATTEMPTS = 14;

interface FailureRecord {
  count: number;
  locked: boolean;
}

const failureMap = new Map<string, FailureRecord>();

function getRecord(username: string): FailureRecord {
  if (!failureMap.has(username)) {
    failureMap.set(username, { count: 0, locked: false });
  }
  return failureMap.get(username)!;
}

/** 检查是否已锁定 */
export function isLocked(username: string): boolean {
  return getRecord(username).locked;
}

/** 记录登录失败,返回 { locked, remaining } */
export function recordFailure(username: string): { locked: boolean; remaining: number } {
  const r = getRecord(username);
  if (r.locked) return { locked: true, remaining: 0 };

  r.count++;
  if (r.count >= MAX_ATTEMPTS) {
    r.locked = true;
    return { locked: true, remaining: 0 };
  }
  return { locked: false, remaining: MAX_ATTEMPTS - r.count };
}

/** 登录成功,清零计数 */
export function recordSuccess(username: string): void {
  failureMap.delete(username);
}
