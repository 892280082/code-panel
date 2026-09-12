// ── Wiki 路由(全局资源,无项目维度)─────────────────────
//   wiki = 个人文档仓库,面板只负责 SSH 公钥 clone / ff-only pull
//   和浏览渲染;写入与 push 由终端里的 claude code 做(SKILL.md)。
//   读=登录;写(config/clone/pull)= 超管。

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { route, errorMessage } from '../utils/route-utils';
import { requireSuperadmin } from '../auth/jwt';
import { safeResolve } from '../utils/safe-resolve';
import { listViewFiles, buildViewPage, isCodeFile, listRenderableFiles, type LinkTarget } from '../prd/view-pages';
import {
  wikiDir, wikiStatus, getWikiConfig, setWikiUrl,
  isValidWikiUrl, cloneWiki, pullWiki, isWikiCloned,
} from '../capsule/wiki-manager';

const router = Router();

// GET /api/wiki/config — 状态卡(url/克隆/分支/commit/dirty/上次同步)
router.get('/api/wiki/config', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: wikiStatus() });
}));

// PUT /api/wiki/config — 配置 SSH 地址 body {url}(保存后未克隆则自动 clone)
router.put('/api/wiki/config', requireSuperadmin, route((req: Request, res: Response) => {
  const { url } = (req.body ?? {}) as { url?: unknown };
  const u = typeof url === 'string' ? url.trim() : '';
  if (!isValidWikiUrl(u)) {
    res.status(400).json({ ok: false, error: '仅支持 SSH 公钥地址(git@…:…/… 或 ssh://git@…/…),不支持 https' });
    return;
  }
  setWikiUrl(u);
  const result = isWikiCloned() ? null : cloneWiki();
  res.json({ ok: true, data: { ...wikiStatus(), sync: result } });
}));

// POST /api/wiki/clone — 手动克隆(已克隆 → already)
router.post('/api/wiki/clone', requireSuperadmin, route((_req: Request, res: Response) => {
  res.json({ ok: true, data: cloneWiki() });
}));

// POST /api/wiki/pull — 手动拉取(--ff-only)
router.post('/api/wiki/pull', requireSuperadmin, route((_req: Request, res: Response) => {
  res.json({ ok: true, data: pullWiki() });
}));

// GET /api/wiki/files — 平铺文件列表(WikiView 侧栏树用)
router.get('/api/wiki/files', route((_req: Request, res: Response) => {
  const root = wikiDir();
  const files = fs.existsSync(root) ? listRenderableFiles(root) : [];
  res.json({ ok: true, data: { clonePath: root, cloned: getWikiConfig().url !== '' && fs.existsSync(path.join(root, '.git')), files } });
}));

// GET /api/wiki/view?file= — 双栏查看页(左导航=全 wiki 文件;linkMode=wiki)
router.get('/api/wiki/view', route((req: Request, res: Response) => {
  const file = typeof req.query.file === 'string' ? req.query.file : '';
  const root = wikiDir();
  const target: LinkTarget = { mode: 'wiki', root };
  try {
    let abs: string;
    if (file.trim()) {
      abs = safeResolve(root, file);
    } else {
      // 默认入口:README.md / index.md 优先,否则第一个
      const files = listViewFiles(root);
      abs = files.find(f => /^(readme|index)\.md$/i.test(path.basename(f))) || files[0];
      if (!abs) {
        res.type('html').send(buildViewPage('# Wiki\n\n仓库里还没有可渲染的文档。', 'index.md', root, [], 'Wiki', false, undefined, undefined, target));
        return;
      }
    }
    if (!fs.statSync(abs).isFile()) { res.status(400).json({ ok: false, error: '目标不是文件' }); return; }
    const md = fs.readFileSync(abs, 'utf-8');
    const rel = path.relative(root, abs);
    res.type('html').send(buildViewPage(md, rel, root, [], `Wiki · ${rel}`, isCodeFile(abs), undefined, undefined, target));
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(msg.includes('traversal') ? 403 : 404).json({ ok: false, error: msg });
  }
}));

export default router;
