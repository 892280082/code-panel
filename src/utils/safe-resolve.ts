// ── 路径安全解析(防目录穿越)────────────────────────────
//   从 repo-browser.ts 提取共享:胶囊/wiki 路由的读文件同样需要,
//   不再各复制一份。越界(逃出 root)一律抛 'Path traversal denied'。

import path from 'path';

/** 把 subPath 安全解析进 rootPath 内;含 .. / 绝对前缀 / \0 / git 引号清洗
 *  `..` 按弹栈语义处理(弹出上一段;栈空即越界 → 抛错),不是简单删除段 */
export function safeResolve(rootPath: string, subPath: string): string {
  const segs: string[] = [];
  for (const raw of subPath.replace(/\0/g, '').replace(/^\/+/, '').replace(/^"|"$/g, '').split('/')) {
    if (!raw || raw === '.') continue;
    if (raw === '..') {
      if (!segs.length) throw new Error('Path traversal denied'); // 越出根,拒
      segs.pop();
      continue;
    }
    segs.push(raw);
  }

  const clean = segs.join('/');
  const full = path.resolve(rootPath, clean);

  // Must be within rootPath(双保险:弹栈逻辑之上再做一次边界校验)
  const normalizedRoot = path.resolve(rootPath) + path.sep;
  const normalizedFull = path.resolve(full) + (full.endsWith(path.sep) ? path.sep : '');

  if (!normalizedFull.startsWith(normalizedRoot) && normalizedFull !== path.resolve(rootPath)) {
    throw new Error('Path traversal denied');
  }

  return path.resolve(rootPath, clean);
}
