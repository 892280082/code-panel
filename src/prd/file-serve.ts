// ── PRD 原型/伪代码文件直读服务 ──────────────────────────
//   sendPrdFile:按扩展名给 MIME(字体/图片走二进制 buffer);
//   codeFileHandler:伪代码文件 → highlight.js 高亮页。

import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import hljs from 'highlight.js';
import { esc } from './md-render';

/** 读取原型 HTML 文件（供 iframe 引用） */
// ⭐2026-08-30 根治:路径式路由 /api/prd/file/<绝对路径> —— iframe 页面内的相对引用(../shared/xx.css)
// 按 URL 目录正确解析(query 形式 p= 无法承载目录上下文,相对引用会解析到 /shared/... 兜底 300B 假响应)
export function sendPrdFile(p: string, res: Response): void {
  if (!fs.existsSync(p)) { res.status(404).send('not found'); return; }
  // ⭐2026-08-30 修:按扩展名返回正确 MIME——之前写死 text/html,Chrome 严格 MIME 检查拒收 css/js
  // (iframe 引用的 ../shared/*.css 全部 200 但样式不生效的根因);字体/图片二进制走 buffer
  const ext = path.extname(p).toLowerCase();
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  };
  if (MIME[ext]) res.set('Content-Type', MIME[ext]); else res.type('html');
  if (['.woff', '.woff2', '.ttf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(ext)) {
    res.send(fs.readFileSync(p));           // 二进制
  } else {
    res.send(fs.readFileSync(p, 'utf-8'));  // 文本
  }
}

/** 读取伪代码文件（供 Tab iframe 嵌套）→ highlight.js 高亮页 */
export function codeFileHandler(p: string, res: Response): void {
  if (!fs.existsSync(p)) { res.status(404).send('not found'); return; }
  const raw = fs.readFileSync(p, 'utf-8');
  // 扩展名 → highlight.js 语言;未知 → 纯文本转义
  const ext = path.extname(p).toLowerCase();
  const LANG: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.java': 'java', '.py': 'python', '.sh': 'bash', '.bash': 'bash', '.sql': 'sql',
    '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json', '.html': 'xml', '.xml': 'xml', '.vue': 'xml',
  };
  let body: string;
  const lang = LANG[ext];
  if (lang) {
    try { body = hljs.highlight(raw, { language: lang }).value; }
    catch { body = esc(raw); }
  } else {
    body = esc(raw);
  }
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#1e2430;color:#abb2bf;font:12px/1.7 "SF Mono",Menlo,Consolas,monospace;padding:14px 16px;tab-size:4}
pre{margin:0;white-space:pre-wrap;word-break:break-all;font:inherit}
code.hljs{font:inherit}
.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-tag{color:#c678dd}
.hljs-string,.hljs-regexp,.hljs-addition{color:#98c379}
.hljs-number,.hljs-literal{color:#d19a66}
.hljs-title,.hljs-title.function_,.hljs-function .hljs-title{color:#61afef}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#d19a66}
.hljs-built_in,.hljs-type,.hljs-class .hljs-title{color:#e6c07b}
.hljs-params{color:#abb2bf}
.hljs-meta,.hljs-meta .hljs-keyword{color:#5c6370}
.hljs-name{color:#e06c75}
.hljs-selector-id,.hljs-selector-class{color:#e06c75}
.hljs-symbol,.hljs-bullet{color:#56b6c2}</style>
</head><body><pre><code class="hljs">${body}</code></pre></body></html>`);
}
