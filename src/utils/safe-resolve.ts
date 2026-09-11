// ── 路径安全解析(防目录穿越)────────────────────────────
//   从 repo-browser.ts 提取共享:胶囊/wiki 路由的读文件同样需要,
//   不再各复制一份。越界(逃出 root)一律抛 'Path traversal denied'。

import path from 'path';

/** 把 subPath 安全解析进 rootPath 内;含 .. / 绝对前缀 / \0 / git 引号清洗 */
export function safeResolve(rootPath: string, subPath: string): string {
  // Strip leading slashes, null bytes, and dot-dot segments
  const clean = subPath
    .replace(/\0/g, '')
    .replace(/^\/+/, '')
    .replace(/^"|"$/g, '') // 防御: 去掉 git 引号转义路径的首尾 "
    .split('/')
    .filter(seg => seg !== '..' && seg !== '')
    .join('/');

  const full = path.resolve(rootPath, clean);

  // Must be within rootPath
  const normalizedRoot = path.resolve(rootPath) + path.sep;
  const normalizedFull = path.resolve(full) + (full.endsWith(path.sep) ? path.sep : '');

  if (!normalizedFull.startsWith(normalizedRoot) && normalizedFull !== path.resolve(rootPath)) {
    throw new Error('Path traversal denied');
  }

  return path.resolve(rootPath, clean);
}
