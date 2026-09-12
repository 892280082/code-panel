// ── 时空胶囊路由(全局资源,无项目维度)─────────────────
//   胶囊 = AI「时空胶囊」写进 ~/.code-panel-capsules/ 的文档。
//   读(list/files/content/view/stream/trash)= 登录即可;写(config/
//   remove/restore)= 超管。渲染复用 PRD 管线(renderContentOnly /
//   buildViewPage + linkMode),入口自做 safeResolve 校验 ——
//   /api/prd/view 的裸 dir 参数绝不直接暴露给胶囊场景。

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { route, errorMessage, startSSE } from '../utils/route-utils';
import { requireSuperadmin } from '../auth/jwt';
import { safeResolve } from '../utils/safe-resolve';
import { buildViewPage, renderContentOnly, listViewFiles, isCodeFile, type LinkTarget } from '../prd/view-pages';
import {
  capsuleDir, setCapsuleDir, scanCapsules, resolveEntry,
  moveToTrash, listTrash, restoreFromTrash, clearCapsules,
} from '../capsule/capsule-store';
import { resetCapsuleMonitor, addCapsuleClient, removeCapsuleClient } from '../capsule/capsule-monitor';

const router = Router();

// ── 配置 ─────────────────────────────────────────────────

// GET /api/capsule/config — 目录 + 存在性 + 条目数
router.get('/api/capsule/config', route((_req: Request, res: Response) => {
  const dir = capsuleDir();
  let exists = false;
  let entryCount = 0;
  try {
    exists = fs.statSync(dir).isDirectory();
    entryCount = fs.readdirSync(dir).filter(n => !n.startsWith('.')).length;
  } catch { /* 目录不存在 */ }
  res.json({ ok: true, data: { dir, exists, entryCount } });
}));

// PUT /api/capsule/config — 改胶囊目录 body {dir}(空=恢复默认)
router.put('/api/capsule/config', requireSuperadmin, route((req: Request, res: Response) => {
  const { dir } = (req.body ?? {}) as { dir?: unknown };
  const v = typeof dir === 'string' ? dir.trim() : '';
  if (!v) {
    // 空串 = 恢复默认:settings 里清自定义值(capsuleDir 兜底回默认)
    setCapsuleDir('');
    resetCapsuleMonitor();
    res.json({ ok: true, data: { dir: capsuleDir() } });
    return;
  }
  try {
    const target = v.startsWith('~/')
      ? path.join(process.env.HOME || '', v.slice(2))
      : path.resolve(v);
    // 校验:目录可创建(不抢已有文件的位置)
    const st = fs.existsSync(target) ? fs.statSync(target) : null;
    if (st && !st.isDirectory()) {
      res.status(400).json({ ok: false, error: `路径已被文件占用: ${target}` });
      return;
    }
    if (!st) fs.mkdirSync(target, { recursive: true });
    setCapsuleDir(v);
    resetCapsuleMonitor();
    res.json({ ok: true, data: { dir: capsuleDir() } });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    res.status(400).json({ ok: false, error: `目录不可用: ${msg}` });
  }
}));

// ── 列表 / SSE ───────────────────────────────────────────

// GET /api/capsule/list — 顶层条目(mtime 倒序)
router.get('/api/capsule/list', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: scanCapsules() });
}));

// GET /api/capsule/stream — SSE(全局,?token= 鉴权由 authMiddleware 处理)
router.get('/api/capsule/stream', route((req: Request, res: Response) => {
  startSSE(res);
  addCapsuleClient(res);
  req.on('close', () => removeCapsuleClient(res));
}));

// ── 内容/渲染 ────────────────────────────────────────────

// GET /api/capsule/files?id= — 条目内可渲染文件平铺列表(入口选择用)
router.get('/api/capsule/files', route((req: Request, res: Response) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id.trim()) { res.status(400).json({ ok: false, error: '缺少 id' }); return; }
  try {
    const { renderDir } = resolveEntry(id);
    const files = listFilesUnder(renderDir);
    res.json({ ok: true, data: { id, files } });
  } catch (err: unknown) {
    respondEntryError(res, err);
  }
}));

// GET /api/capsule/content?id= — 单文件暗色渲染页(iframe 用)
router.get('/api/capsule/content', route((req: Request, res: Response) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id.trim()) { res.status(400).json({ ok: false, error: '缺少 id' }); return; }
  try {
    const { abs, kind, renderDir } = resolveEntry(id);
    if (kind !== 'file') {
      res.status(400).json({ ok: false, error: 'content 仅用于文件条目(目录用 view)' });
      return;
    }
    const md = fs.readFileSync(abs, 'utf-8');
    const target: LinkTarget = { mode: 'capsule', root: renderDir, id };
    res.type('html').send(renderContentOnly(md, renderDir, [], id, target));
  } catch (err: unknown) {
    respondEntryError(res, err);
  }
}));

// GET /api/capsule/view?id=&file= — 双栏查看页(左导航=条目全部文件)
router.get('/api/capsule/view', route((req: Request, res: Response) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const file = typeof req.query.file === 'string' ? req.query.file : '';
  if (!id.trim()) { res.status(400).json({ ok: false, error: '缺少 id' }); return; }
  try {
    const { renderDir } = resolveEntry(id);
    const root = renderDir;
    const target: LinkTarget = { mode: 'capsule', root, id };

    let targetFile: string;
    if (file.trim()) {
      targetFile = safeResolve(root, file);
    } else {
      // 默认入口:index.md 优先,否则第一个可渲染文件
      const files = listFilesUnder(root);
      if (!files.length) {
        res.type('html').send(renderContentOnly('# 空胶囊\n\n该胶囊没有可渲染文件。', root, [], '空胶囊'));
        return;
      }
      targetFile = files.find(f => path.basename(f.path) === 'index.md')?.path || files[0].path;
    }
    if (!fs.statSync(targetFile).isFile()) { res.status(400).json({ ok: false, error: '目标不是文件' }); return; }

    const md = fs.readFileSync(targetFile, 'utf-8');
    const rel = path.relative(root, targetFile);
    res.type('html').send(buildViewPage(md, rel, root, [], id, isCodeFile(targetFile), undefined, undefined, target));
  } catch (err: unknown) {
    respondEntryError(res, err);
  }
}));

// ── 删除(回收站)/ 恢复 ──────────────────────────────────

// POST /api/capsule/remove — 删除条目 body {id}:挪进 .trash/(7 天内可恢复)
router.post('/api/capsule/remove', requireSuperadmin, route((req: Request, res: Response) => {
  const { id } = (req.body ?? {}) as { id?: unknown };
  const name = typeof id === 'string' ? id.trim() : '';
  if (!name) { res.status(400).json({ ok: false, error: '缺少 id' }); return; }
  try {
    const abs = safeResolve(capsuleDir(), name);
    if (abs === path.resolve(capsuleDir())) {
      res.status(400).json({ ok: false, error: '不能删除胶囊根目录' });
      return;
    }
    if (!fs.existsSync(abs)) { res.status(404).json({ ok: false, error: `胶囊不存在: ${name}` }); return; }
    const trashName = moveToTrash(abs, name);
    resetCapsuleMonitor(); // 立即重基线,不推 removed
    res.json({ ok: true, data: { trashName } });
  } catch (err: unknown) {
    respondEntryError(res, err);
  }
}));

// POST /api/capsule/clear — 清空全部胶囊(逐条挪回收站)
router.post('/api/capsule/clear', requireSuperadmin, route((_req: Request, res: Response) => {
  const cleared = clearCapsules();
  resetCapsuleMonitor();
  res.json({ ok: true, data: { cleared } });
}));

// GET /api/capsule/trash — 回收站列表(7 天保留,过期自动清)
router.get('/api/capsule/trash', route((_req: Request, res: Response) => {
  res.json({ ok: true, data: { items: listTrash() } });
}));

// POST /api/capsule/restore — 从回收站恢复 body {name=回收站条目名}
router.post('/api/capsule/restore', requireSuperadmin, route((req: Request, res: Response) => {
  const { name } = (req.body ?? {}) as { name?: unknown };
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) { res.status(400).json({ ok: false, error: '缺少 name' }); return; }
  try {
    const restored = restoreFromTrash(raw);
    resetCapsuleMonitor();
    res.json({ ok: true, data: { restored } });
  } catch (err: unknown) {
    respondEntryError(res, err);
  }
}));

// ── 局部工具 ─────────────────────────────────────────────

/** 目录下可渲染文件平铺(listViewFiles 的相对路径版) */
function listFilesUnder(dir: string): { path: string; name: string; size: number; mtime: number }[] {
  // 复用 PRD 管线的递归列表(深度≤4、跳软链、md+代码)
  return listViewFiles(dir).map(f => {
    const st = fs.statSync(f);
    return { path: path.relative(dir, f), name: path.basename(f), size: st.size, mtime: st.mtimeMs };
  });
}

/** 条目类错误的统一出口:路径越狱 403 / 不存在 404 / 其余 500 */
function respondEntryError(res: Response, err: unknown): void {
  const msg = errorMessage(err);
  const status = msg.includes('traversal') ? 403 : msg.includes('不存在') ? 404 : 500;
  res.status(status).json({ ok: false, error: msg });
}

export default router;
