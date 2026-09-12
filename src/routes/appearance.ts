// ── 装修路由(⚙ →「装修」Tab)──────────────────────────
//   faviconRouter(公开,挂 static 之前):GET /favicon.svg 按预设色动态渲染
//   appearanceRouter(登录,挂 API 区):GET/PUT /api/appearance/favicon 预设读写

import { Router, Request, Response } from 'express';
import { route } from '../utils/route-utils';
import { getSetting, setSetting } from '../db/settings';
import { FAVICON_PRESETS, findFaviconPreset, renderFaviconSvg } from '../appearance/favicon';

const SETTING_KEY = 'faviconPreset';

/** 当前预设 id(库里的值不认识时回落默认绿) */
function currentPresetId(): string {
  const id = getSetting<string>(SETTING_KEY, 'green');
  return findFaviconPreset(id) ? id : 'green';
}

// ── favicon 本体(无需登录 —— 登录页的标签也要有图标)─────
//   必须挂在 express.static 之前,才能盖过 vite 拷进 dist 的静态绿文件。
export const faviconRouter = Router();

faviconRouter.get('/favicon.svg', route((_req: Request, res: Response) => {
  const preset = findFaviconPreset(currentPresetId()) ?? FAVICON_PRESETS[0];
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=60'); // 换色后面板带 ?v= 戳立即换新
  res.send(renderFaviconSvg(preset.color));
}));

// ── 预设读写(登录即可;面板级设置,存全局 settings 表)─────
const appearanceRouter = Router();

appearanceRouter.get('/api/appearance/favicon', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: { presets: FAVICON_PRESETS, current: currentPresetId() } });
}));

appearanceRouter.put('/api/appearance/favicon', route((req: Request, res: Response) => {
  const id = (req.body as { preset?: unknown })?.preset;
  if (typeof id !== 'string' || !findFaviconPreset(id)) {
    res.status(400).json({ ok: false, error: `未知预设:${String(id)}` });
    return;
  }
  setSetting(SETTING_KEY, id);
  res.json({ ok: true, data: { current: id } });
}));

export default appearanceRouter;
