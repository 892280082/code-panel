// ── 文件交换(云抽屉):上传给机器 / 下载 AI 产物 ────────────
//   作用域:按项目。每项目一套「上传目录 + 下载目录」,默认为
//     <项目根>/.code-panel/uploads    ← 浏览器上传到这,复制绝对路径给终端/AI 用
//     <项目根>/.code-panel/downloads  ← AI/命令把文件写进来,浏览器点下载拿回
//   目录可在 ⚙ 配置「文件」Tab 改(存 .code-panel/data/files-config.json,随项目、gitignore)。
//   端点(均需 ?project=<id> + 登录):
//     GET  /api/files/config                     → { upload, download } 绝对路径
//     PUT  /api/files/config                     → 保存(空串=恢复默认)
//     GET  /api/files?side=upload|download        → 该目录文件列表(新→旧)
//     POST /api/files/upload                     → multipart 'files'(可多个)
//     POST /api/files/paste-image                → { dataUrl } 剪贴板粘贴图片落 uploads
//     GET  /api/files/raw?side=&name=            → 读文件内容(inline,按扩展名给 MIME)

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { ProjectRow } from '../db/global-store';
import { requireProject, reqProject } from '../projects/context';
import { readRuntimeJson, writeRuntimeJson } from '../projects/project-store';
import { route } from '../utils/route-utils';

const router = Router();

// ── 目录配置 ────────────────────────────────────────────────
const CFG_FILE = 'cloud-config.json';
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

/** 读某项目云文件目录配置(绝对路径)。空/缺省 → 默认 <root>/.code-panel/{uploads,downloads} */
function filesDirs(project: ProjectRow): { upload: string; download: string } {
  const cfg = (readRuntimeJson(project, CFG_FILE, {}) || {}) as { upload?: string; download?: string };
  const base = path.join(project.root, '.code-panel');
  const resolveAbs = (v: unknown, def: string) =>
    typeof v === 'string' && v.trim() ? path.resolve(project.root, v.trim()) : def;
  const dirs = {
    upload: resolveAbs(cfg.upload, path.join(base, 'uploads')),
    download: resolveAbs(cfg.download, path.join(base, 'downloads')),
  };
  for (const d of [dirs.upload, dirs.download]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  return dirs;
}

function sideDir(project: ProjectRow, side: string): string {
  const dirs = filesDirs(project);
  return side === 'download' ? dirs.download : dirs.upload;
}

// GET /api/files/config — 当前配置(绝对路径;空=默认)
router.get('/api/files/config', requireProject, route((req: Request, res: Response) => {
  const dirs = filesDirs(reqProject(req));
  res.json({ ok: true, data: { upload: dirs.upload, download: dirs.download } });
}));

// PUT /api/files/config — 保存(空串恢复默认)
router.put('/api/files/config', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const b = (req.body ?? {}) as { upload?: unknown; download?: unknown };
  const save: Record<string, string> = {};
  for (const k of ['upload', 'download'] as const) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) save[k] = v.trim();
  }
  writeRuntimeJson(project, CFG_FILE, save);
  const dirs = filesDirs(project);
  res.json({ ok: true, data: { upload: dirs.upload, download: dirs.download } });
}));

// ── 列表 ────────────────────────────────────────────────────
// 文件名/目录条目(忽略子目录),按 mtime 新→旧
function listSide(dir: string): unknown[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const p = path.join(dir, d.name);
      const st = fs.statSync(p);
      const ext = path.extname(d.name).toLowerCase();
      return {
        name: d.name,
        size: st.size,
        mtime: Math.round(st.mtimeMs),
        ext,
        image: IMG_EXT.has(ext),
        abs: p,
      };
    })
    .sort((a: any, b: any) => b.mtime - a.mtime);
}

router.get('/api/files', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const side = typeof req.query.side === 'string' && req.query.side === 'download' ? 'download' : 'upload';
  const dir = sideDir(project, side);
  res.json({ ok: true, data: { side, dir, files: listSide(dir) } });
}));

// ── 上传(multipart)─────────────────────────────────────────
const MIME_EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg',
  'text/plain': '.txt', 'text/html': '.html', 'text/css': '.css', 'application/json': '.json',
  'text/csv': '.csv', 'application/pdf': '.pdf', 'application/zip': '.zip',
};

/** 去掉路径目录与危险字符,保留原名可读性 */
function safeName(name: string): string {
  let base = path.basename(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  if (!base) base = 'file';
  return base;
}

/** 修中文文件名乱码:浏览器 multipart 的 filename 不带 RFC5987 编码时,
 *  busboy 默认按 latin1 解码 → UTF-8 中文名变 "ä¸­æ" 这类 mojibake。
 *  latin1 展开的 UTF-8 序列有固定特征(首字节 U+00C2-U+00F4 后跟 U+0080-U+00BF),
 *  检测到才转回 UTF-8;正常文件名(含已正确的中文)不匹配特征,原样返回。 */
function fixMojibakeName(name: string): string {
  return /[\u00C2-\u00F4][\u0080-\u00BF]/.test(name)
    ? Buffer.from(name, 'latin1').toString('utf8')
    : name;
}

/** 冲突则追加 -1/-2… 后缀(绝对路径给终端用,避免空格) */
function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let cand = name;
  let i = 1;
  while (fs.existsSync(path.join(dir, cand))) cand = `${base}-${i++}${ext}`;
  return cand;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req: any, _file: any, cb) => {
      try { cb(null, sideDir(reqProject(req), 'upload')); } catch (e) { cb(e as Error, ''); }
    },
    filename: (req: any, file: any, cb) => {
      try {
        const dir = sideDir(reqProject(req), 'upload');
        cb(null, uniqueName(dir, safeName(fixMojibakeName(file.originalname))));
      } catch (e) { cb(e as Error, ''); }
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post('/api/files/upload', requireProject, upload.array('files', 20), route((req: Request, res: Response) => {
  const project = reqProject(req);
  const dir = sideDir(project, 'upload');
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  const uploaded = files.map((f) => {
    const st = fs.statSync(f.path);
    const ext = path.extname(f.filename).toLowerCase();
    return { name: f.filename, size: st.size, mtime: Math.round(st.mtimeMs), ext, image: IMG_EXT.has(ext), abs: f.path };
  });
  res.json({ ok: true, data: { dir, uploaded } });
}));

// ── 剪贴板粘贴图片(dataURL → png/jpg/…)────────────────────
router.post('/api/files/paste-image', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const dataUrl = (req.body?.dataUrl ?? '') as string;
  const m = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,(.+)$/.exec(dataUrl);
  if (!m) return res.status(400).json({ ok: false, error: '需 data:image/*;base64 格式的 dataUrl' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return res.status(400).json({ ok: false, error: '图片内容为空' });
  const ext = MIME_EXT[m[1]] || '.png';
  const dir = sideDir(project, 'upload');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = uniqueName(dir, `paste-${stamp}${ext}`);
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  res.json({ ok: true, data: { name, size: buf.length, mtime: Date.now(), ext, image: true, abs: p } });
}));

// ── 读文件内容(缩略图/预览/下载)─────────────────────────
const EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.zip': 'application/zip', '.sql': 'text/plain; charset=utf-8',
};

router.get('/api/files/raw', requireProject, route((req: Request, res: Response) => {
  const project = reqProject(req);
  const side = typeof req.query.side === 'string' && req.query.side === 'download' ? 'download' : 'upload';
  const name = typeof req.query.name === 'string' ? path.basename(req.query.name) : '';
  if (!name) return res.status(400).json({ ok: false, error: '缺少 name' });
  const dir = sideDir(project, side);
  const p = path.join(dir, name);
  if (!p.startsWith(dir) || !fs.existsSync(p)) return res.status(404).json({ ok: false, error: '文件不存在' });
  const ext = path.extname(p).toLowerCase();
  res.setHeader('Content-Type', EXT_MIME[ext] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}));

export default router;
