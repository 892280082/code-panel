// ── PRD 面板路由：文件夹列表 → MD 文件 → 双栏渲染（左 MD 列表 + 右渲染 HTML + 原型 iframe）──
// 配置随项目:<项目根>/.code-panel/prd.yaml(dir + folders);完成状态落 data/prd-status.json。
// 渲染/页面组装在 src/prd/{md-render,view-pages,file-serve}.ts,本文件只做路由。
import { Router, Request } from 'express';
import fs from 'fs';
import path from 'path';
import type { ProjectRow } from '../db/global-store';
import { requireProject, resolveProject, reqProject } from '../projects/context';
import { loadProjectModule } from '../projects/project-store';
import { prdDoneGet, prdDoneSet } from '../projects/adapters';
import type { PrdModuleYaml } from '../projects/yaml';
import { route } from '../utils/route-utils';
import { buildViewPage, renderContentOnly, CODE_EXTS } from '../prd/view-pages';
import { sendPrdFile, codeFileHandler } from '../prd/file-serve';
import { genAllBoards } from '../prd/board-gen';

const router = Router();

// ── 配置(项目 prd.yaml)─────────────────────────────────

/** 读项目 prd.yaml(缺省空) */
function loadPrd(project: ProjectRow): PrdModuleYaml {
  return loadProjectModule(project, 'prd') as PrdModuleYaml;
}

/** 请求若带了 project(查询/头/body),则取其 prd.yaml 上下文(dir+folders) */
function prdCtxFromReq(req: Request): PrdModuleYaml {
  const r = resolveProject(req);
  if (r.project) return loadPrd(r.project);
  return { dir: '', folders: [] };
}

function listMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => path.join(dir, f));
}

// ── 完成状态：针对整个目录(随项目,落 data/prd-status.json) ──

/** 目录是否已完成(项目维度) */
function isDirDone(project: ProjectRow, dir: string): boolean {
  return !!prdDoneGet(project)[dir];
}

/** 标记目录完成/未完成(项目维度) */
function setDirDone(project: ProjectRow, dir: string, done: boolean): void {
  prdDoneSet(project, dir, done);
}

// ── 路由 ────────────────────────────────────────────────

/** 看板重绘:跑内置生成器整份重写 <项目根>/.code-panel/prd/<人名>/index.md(全中心)。
 *  消费方:前端 ↻ Refresh 按钮 + 本机 AI `cp post /api/prd/gen-board`(免密)。 */
router.post('/api/prd/gen-board', requireProject, route((req, res) => {
  const project = reqProject(req);
  const output = genAllBoards(project.root);
  res.json({ ok: true, output });
}));

/** 文件夹列表（名称 / 目录 / 创建日期;来自该项目 prd.yaml） */
router.get('/api/prd/folders', requireProject, route((req, res) => {
  const project = reqProject(req);
  const cfg = loadPrd(project);
  const folders = (cfg.folders || [])
    .filter(f => f.dir && fs.existsSync(f.dir))
    .map(f => {
      let date = '';
      try {
        const st = fs.statSync(f.dir);
        const d = st.birthtime || st.mtime;
        date = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
      } catch { /* ignore */ }
      return { name: f.name, dir: f.dir, fileCount: listMdFiles(f.dir).length, date, done: isDirDone(project, f.dir) };
    });
  res.json({ ok: true, folders });
}));

/** 某文件夹下的 MD 文件列表 */
router.get('/api/prd/files', route((req, res) => {
  const dir = String(req.query.dir || '');
  if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: '目录不存在' });
  const files = listMdFiles(dir).map(f => ({ name: path.basename(f), path: f }));
  res.json({ ok: true, files });
}));

/** 切换目录完成状态（针对整个目录;落项目 data/prd-status.json） */
router.post('/api/prd/done', requireProject, route((req, res) => {
  const project = reqProject(req);
  const dir = String((req.body as { dir?: unknown })?.dir || '');
  const done = Boolean((req.body as { done?: unknown })?.done);
  if (!dir) return res.status(400).json({ ok: false, error: 'dir is required' });
  setDirDone(project, dir, done);
  res.json({ ok: true, dir, done });
}));

/** 内嵌预览接口（无左侧导航，用于右侧预览 div iframe;prd.yaml.dir 作原型 extraBase 参考） */
router.get('/api/prd/content', route((req, res) => {
  const dir = String(req.query.dir || '');
  const file = String(req.query.file || '');
  if (!fs.existsSync(dir)) return res.status(404).send('目录不存在');
  const abs = path.join(dir, file);
  if (!fs.existsSync(abs) || !abs.endsWith('.md')) return res.status(404).send('文档不存在');
  try {
    const md = fs.readFileSync(abs, 'utf-8');
    const ctx = prdCtxFromReq(req);
    const bases = [ctx.dir, dir].filter(Boolean) as string[];
    res.type('html').send(renderContentOnly(md, dir, bases, file));
  } catch (e: any) {
    res.status(500).send(String(e?.message || e));
  }
}));

/** 双栏查看页：左 文件列表（md + 伪代码文件）+ 右渲染 HTML */
router.get('/api/prd/view', route((req, res) => {
  const dir = String(req.query.dir || '');
  const file = String(req.query.file || '');
  if (!fs.existsSync(dir)) return res.status(404).send('目录不存在');
  const abs = path.join(dir, file);
  const isCode = CODE_EXTS.includes(path.extname(abs).toLowerCase());
  if (!fs.existsSync(abs) || (!abs.endsWith('.md') && !isCode)) return res.status(404).send('文档不存在');
  try {
    const content = fs.readFileSync(abs, 'utf-8');
    const ctx = prdCtxFromReq(req);
    const bases = [ctx.dir, dir].filter(Boolean) as string[];
    const r = resolveProject(req);
    const html = buildViewPage(content, file, dir, bases, file, isCode, ctx, r.project?.id);
    res.type('html').send(html);
  } catch (e: any) {
    res.status(500).send(String(e?.message || e));
  }
}));

router.get('/api/prd/file/*splat', route((req, res) => {
  const segs = Array.isArray(req.params.splat) ? req.params.splat : [req.params.splat];
  sendPrdFile('/' + segs.map(decodeURIComponent).join('/'), res);   // ⭐express5 splat 是分段数组
}));
router.get('/api/prd/file', route((req, res) => {
  sendPrdFile(String(req.query.p || ''), res);
}));

/** 读取伪代码文件（供 Tab iframe 嵌套） */
router.get('/api/prd/code-file/*splat', route((req, res) => {
  const segs = Array.isArray(req.params.splat) ? req.params.splat : [req.params.splat];
  codeFileHandler('/' + segs.map(decodeURIComponent).join('/'), res);
}));
router.get('/api/prd/code-file', route((req, res) => {
  codeFileHandler(String(req.query.p || ''), res);
}));

export default router;
