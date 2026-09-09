// ── 共享路由工具(全部路由可用)──────────────────────────
//   route:   路由包装器 —— 同步/异步异常统一捕获 → {ok:false,error} 信封,
//            消除每个 handler 手写的 try/catch 样板(此前 ~70 处、5 种写法)
//   reqProject: 见 projects/context.ts(单一定义)

import { Request, Response, RequestHandler } from 'express';

/** Parse :id route param, return null and send 400 on invalid */
export function parseRouteId(req: Request, res: Response, paramName = 'id'): number | null {
  const id = parseInt(String(req.params[paramName] ?? ''), 10);
  if (isNaN(id)) { res.status(400).json({ ok: false, error: `invalid ${paramName}` }); return null; }
  return id;
}

/** Parse an optional query parameter as integer, returning undefined on missing/invalid */
export function parseQueryInt(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseInt(val as string);
  return isNaN(n) ? undefined : n;
}

/** Safe error message extraction — avoids runtime errors on non-Error throws */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 路由包装器:`router.get('/api/x', requireProject, route(async (req, res) => { ... }))`
 * handler 内直接写业务逻辑,抛错(含 async reject)自动落 500 信封;
 * 已开始响应(headersSent)则不再覆盖。返回值忽略 —— 响应仍由 handler 自己 res.json。
 */
export function route(handler: (req: Request, res: Response) => unknown): RequestHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      // async 包一层 = 同步 throw 也会变 reject,统一进这里
      if (!res.headersSent) res.status(500).json({ ok: false, error: errorMessage(e) });
    }
  };
}
