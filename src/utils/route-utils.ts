// ── Shared route utilities (精简版, 供 git 相关路由使用) ──

import { Request, Response } from 'express';

/** Parse :id route param, return null and send 400 on invalid */
export function parseRouteId(req: Request, res: Response, paramName = 'id'): number | null {
  const id = parseInt(req.params[paramName], 10);
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
