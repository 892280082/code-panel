// ── PRD 面板：文件夹列表 → MD 文件 → 双栏渲染（左 MD 列表 + 右渲染 HTML + 原型 iframe）──
// 配置随项目:<项目根>/.code-panel/prd.yaml(dir + folders);完成状态落 data/prd-status.json。
import { Router, Request } from 'express';
import fs from 'fs';
import path from 'path';
import type { ProjectRow } from '../db/global-store';
import { requireProject, resolveProject } from '../projects/context';
import { loadProjectModule } from '../projects/project-store';
import { prdDoneGet, prdDoneSet } from '../projects/adapters';
import type { PrdModuleYaml } from '../projects/yaml';

const router = Router();

// ── 配置(项目 prd.yaml)─────────────────────────────────

interface PrdFolder { name: string; dir: string }

/** 取中间件挂好的 project */
function reqProject(req: Request): ProjectRow {
  return (req as Request & { project: ProjectRow }).project;
}

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

/** 可浏览的代码文件扩展名（伪代码目录等） */
const CODE_EXTS = ['.ts', '.js', '.jsx', '.tsx', '.java', '.sql', '.py', '.json', '.yaml', '.yml', '.sh', '.go', '.vue'];

/** 视图导航文件列表：md + 代码文件（伪代码目录能看到所有步骤文件） */
function listViewFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return f.endsWith('.md') || CODE_EXTS.includes(ext);
    })
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

// ── Markdown → HTML（自包含 JS 转换器）──────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

/** 按表头语义定列权值(计划类=窄但保底,内容/状态=宽),同表头表格跨表列宽对齐 */
function colWeight(h: string): number {
  if (/计划|平台|仓库|步骤|环节|顺序|版本|序号/.test(h)) return 1.0;   // 名称列:窄,但不再被压成竖排
  if (/伪代码|代码|文档|文件/.test(h)) return 1.4;                      // 中
  if (/内容|要点|描述|做法|说明|决策|来源|目标|备注/.test(h)) return 2.6; // 长文本:宽
  if (/状态|结果/.test(h)) return 2.1;                                  // 状态说明较长
  return 1.6;
}

/** 拆表格行单元格：`\|` 是转义竖线(内容里的字面 |)，不算分隔符——负向后行断言只在「非 \ 前缀」的 | 处切开 */
function splitRow(line: string): string[] {
  const safe = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return safe.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
}

function mdTable(rows: string[]): string {
  const head = splitRow(rows[0]);
  const w = head.map(colWeight);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const cg = '<colgroup>' + w.map(x => `<col style="width:${((x / total) * 100).toFixed(2)}%">`).join('') + '</colgroup>';
  let h = '<table>' + cg;
  for (let i = 0; i < rows.length; i++) {
    if (i === 1) continue;
    const cells = splitRow(rows[i]);
    const tag = i === 0 ? 'th' : 'td';
    h += '<tr>' + cells.map(c => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
  }
  return h + '</table>';
}

/** 伪代码 Tab：把 `> 前端/后端/模块：` + 代码块 渲染成 Tab 标签页 */
function buildTabHtml(tabs: { label: string; lang: string; code: string }[]): string {
  let h = '<div class="code-tabs"><div class="tabs-head">';
  tabs.forEach((t, i) => {
    h += `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${i}">${esc(t.label)}</button>`;
  });
  h += '</div>';
  tabs.forEach((t, i) => {
    const isMermaid = t.lang.trim() === 'mermaid';
    const codeHtml = isMermaid ? `<pre class="mermaid">${t.code}</pre>` : `<pre><code>${t.code}</code></pre>`;
    h += `<div class="tab-panel" data-tab="${i}"${i === 0 ? '' : ' hidden'}>${codeHtml}</div>`;
  });
  h += '</div>';
  return h;
}

export function markdownToHtml(md: string): string {
  // —— 伪代码 Tab 预处理：`> 标签：` + 代码块（连续多个）→ 占位符，主循环渲染成 Tab ——
  const tabGroups: { label: string; lang: string; code: string }[][] = [];
  const tabRe = /(?:> [^\n：:]+[：:][^\n]*\n```[^\n]*\n[\s\S]*?\n```\n?)+/g;
  const md2 = md.replace(tabRe, (m) => {
    const list: { label: string; lang: string; code: string }[] = [];
    const re = />\s*([^\n：:]+)[：:][^\n]*\n```([^\n]*)\n([\s\S]*?)\n```/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(m)) !== null) {
      list.push({ label: mm[1].trim(), lang: mm[2].trim(), code: mm[3] });
    }
    tabGroups.push(list);
    return '\x00TAB' + (tabGroups.length - 1) + '\x00';
  });

  const lines = md2.split('\n');
  const out: string[] = [];
  let inCode = false, codeLang = '', codeBuf: string[] = [];
  let inTable = false, tableBuf: string[] = [];
  let inUl = false, inOl = false;

  const closeCode = () => {
    if (inCode) {
      const isMermaid = codeLang.trim() === 'mermaid';
      out.push(isMermaid ? `<pre class="mermaid">${codeBuf.join('\n')}</pre>` : `<pre><code>${codeBuf.join('\n')}</code></pre>`);
      codeBuf = []; inCode = false;
    }
  };
  const closeTable = () => { if (inTable) { out.push(mdTable(tableBuf)); tableBuf = []; inTable = false; } };
  const closeLists = () => { if (inUl) { out.push('</ul>'); inUl = false; } if (inOl) { out.push('</ol>'); inOl = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const s = line.trim();

    if (s.startsWith('```')) {
      if (inCode) closeCode();
      else { closeTable(); closeLists(); inCode = true; codeLang = s.slice(3); }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const tabPh = s.match(/^\u0000TAB(\d+)\u0000$/);
    if (tabPh) {
      closeTable(); closeLists();
      out.push(buildTabHtml(tabGroups[Number(tabPh[1])]));
      continue;
    }

    if (/^\|.*\|$/.test(s) && i + 1 < lines.length && /^\|[\s:\-|]+\|$/.test(lines[i + 1].trim())) {
      closeTable(); closeLists();
      inTable = true; tableBuf = [s, lines[i + 1].trim()];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { tableBuf.push(lines[i].trim()); i++; }
      closeTable();
      continue;
    }
    if (inTable) closeTable();

    const hm = s.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { closeTable(); closeLists(); out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) { closeTable(); closeLists(); out.push('<hr>'); continue; }

    if (s.startsWith('>')) { closeTable(); closeLists(); out.push(`<blockquote>${inline(s.replace(/^>\s?/, ''))}</blockquote>`); continue; }

    const um = s.match(/^[-*+]\s+(.*)$/);
    if (um) { closeTable(); if (!inUl) { out.push('<ul>'); inUl = true; } out.push(`<li>${inline(um[1])}</li>`); continue; }
    if (inUl) { out.push('</ul>'); inUl = false; }
    const om = s.match(/^\d+[.)]\s+(.*)$/);
    if (om) { closeTable(); if (!inOl) { out.push('<ol>'); inOl = true; } out.push(`<li>${inline(om[1])}</li>`); continue; }
    if (inOl) { out.push('</ol>'); inOl = false; }

    if (!s) { closeLists(); closeTable(); continue; }
    out.push(`<p>${inline(s)}</p>`);
  }
  closeCode(); closeLists(); closeTable();
  return out.join('\n');
}

// ── 原型引用 + 双栏查看页 ──────────────────────────────

function findHtmlRefs(md: string, baseDir: string, extraBases: string[] = []): { name: string; url: string }[] {
  const refs: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /([A-Za-z0-9_\-\/\.\\\u4e00-\u9fff]+\.html)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const raw = m[1].replace(/[`"'()\[\]<>]/g, '');
    if (seen.has(raw)) continue;
    seen.add(raw);
    let found = '';
    if (path.isAbsolute(raw)) { found = raw; }
    else {
      const bases = [baseDir, ...extraBases];
      found = bases.map(b => path.resolve(b, raw)).find(p => fs.existsSync(p)) || '';
    }
    if (found && fs.existsSync(found)) refs.push({ name: raw, url: '/api/prd/file/' + encodeURI(found) });   // ⭐路径式:相对引用可解析
  }
  return refs;
}

/** 把 MD 中 `> 原型图：`code`路径.html``` 的引用原地替换为内联原型 iframe（不再堆到文档末尾） */
function inlineProtoSections(body: string, refs: { name: string; url: string }[]): string {
  let b = body;
  for (const r of refs) {
    const escName = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const proto = `<section class="proto"><div class="proto-head">📎 原型：<code>${r.name}</code></div><iframe src="${r.url}" class="proto-frame"></iframe></section>`;
    b = b.replace(new RegExp(`<blockquote>原型图：<code>${escName}</code></blockquote>`), proto);
    // ⭐2026-08-30 补：链接格式 `> 原型图：[名](路径.html)` 渲染出的 <a> 形式同样内嵌 iframe（之前只显示文字链接）
    b = b.replace(new RegExp(`<blockquote>原型图：<a href="${escName}">[^<]*</a></blockquote>`), proto);
  }
  return b;
}

/** 伪代码 Tab（模块化）：MD 里 `> @tabs 步骤N` → 读 `伪代码/步骤N*.ext` → 每文件一个 Tab(iframe)。
 *   ⛶ 最大化 = 全屏 overlay：左 = 该步骤全部端文件导航，右 = 大代码 iframe(参考 repo-browser 左树右内容)。 */
function buildTabWidget(base: string, dir: string): string {
  const codeDir = path.join(dir, '伪代码');
  let files: string[] = [];
  try {
    files = fs.readdirSync(codeDir).filter(f => f.startsWith(base) && fs.statSync(path.join(codeDir, f)).isFile()).sort();
  } catch { /* 目录不存在 */ }
  if (files.length === 0) return `<p class="muted">（伪代码缺失：${esc(base)} 目录下无匹配文件）</p>`;
  const escBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelOf = (f: string) => (f.replace(new RegExp('^' + escBase + '-?'), '').replace(/\.[^.]+$/, '') || f).replace(/-/g, ' · ');
  const absOf = (f: string) => path.join(codeDir, f);
  const urlOf = (f: string) => `/api/prd/code-file/${encodeURI(absOf(f))}`;

  let h = '<div class="code-tabs"><div class="tabs-head">';
  files.forEach((f, i) => {
    h += `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${i}" data-url="${esc(urlOf(f))}">${esc(labelOf(f))}</button>`;
  });
  h += `<button class="tabs-max" title="全屏查看代码">⛶</button></div>`;
  files.forEach((f, i) => {
    h += `<div class="tab-panel" data-tab="${i}"${i === 0 ? '' : ' hidden'}><iframe src="${urlOf(f)}" class="code-frame"></iframe></div>`;
  });
  // 最大化层:左文件导航 + 右代码 iframe
  h += `<div class="max-overlay" hidden>
    <div class="max-head"><span class="max-title">${esc(base)} 伪代码（${files.length} 个文件）</span>
      <button class="max-close" title="关闭">✕</button></div>
    <div class="max-body">
      <div class="max-nav">${files.map((f, i) =>
        `<button class="max-item${i === 0 ? ' on' : ''}" data-url="${esc(urlOf(f))}">${esc(labelOf(f))}</button>`,
      ).join('')}</div>
      <div class="max-code"><iframe src="${urlOf(files[0])}"></iframe></div>
    </div>
  </div>`;
  h += '</div>';
  return h;
}

/** 把 MD 渲染后的 `> @tabs <base>` blockquote 替换为 Tab 组件 */
function inlineTabWidgets(body: string, md: string, dir: string): string {
  let b = body;
  const re = /<blockquote>@tabs ([^<]+)<\/blockquote>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    b = b.replace(m[0], buildTabWidget(m[1].trim(), dir));
  }
  return b;
}

/** 改写正文相对链接（2026-08-24）：.md → 面板 view 页；.html → file 直读；绝对/锚点不动 */
// ⭐2026-09-05：追加 projQ —— 整屏 iframe 内点正文链接翻页时把 ?project= 带上，新页才认得 prd.yaml（extraBase/返回首页）
function rewriteLinks(html: string, dir: string, projQ = ''): string {
  return html.replace(/<a href="([^"]+)">/g, (m, href: string) => {
    if (/^(https?:|\/\/|#|mailto:|\/api\/)/.test(href)) return m;
    let raw = href;
    try { raw = decodeURIComponent(href); } catch { /* 保留原样 */ }
    const abs = path.resolve(dir, raw);
    if (/\.md$/i.test(raw)) {
      return `<a href="/api/prd/view?dir=${encodeURIComponent(path.dirname(abs))}&file=${encodeURIComponent(path.basename(abs))}${projQ}">`;
    }
    if (/\.html?$/i.test(raw)) {
      return `<a href="/api/prd/file/${encodeURI(abs)}" target="_blank">`;
    }
    return m;
  });
}

/** 双栏查看页：左 = 该目录 MD 文件列表，右 = 渲染当前 MD + 原型 iframe */
function buildViewPage(md: string, mdName: string, dir: string, extraBases: string[], title: string, isCode = false, prdCtx?: PrdModuleYaml, projectId?: string): string {
  // 返回需求中心首页：该项目 prd.yaml folders 中当前 dir 的祖先目录（有 index.md 才显示）
  const folders = prdCtx?.folders ?? [];
  const projQ = projectId ? `&project=${encodeURIComponent(projectId)}` : '';
  const rootFolder = folders.find(f => dir === f.dir || dir.startsWith(f.dir + path.sep));
  const homeNav = rootFolder && fs.existsSync(path.join(rootFolder.dir, 'index.md'))
    ? (dir === rootFolder.dir ? '' : `<a class="home" href="/api/prd/view?dir=${encodeURIComponent(rootFolder.dir)}&file=index.md${projQ}"><span class="arrow">‹</span>返回需求中心首页</a>`)
    : '';
  const refs = findHtmlRefs(md, dir, extraBases);
  // 代码文件（伪代码目录的 .ts 等）→ 原样代码视图；md → 正常 markdown 渲染
  const bodyHtml = isCode
    ? `<pre class="code-pre"><code>${esc(md)}</code></pre>`
    : rewriteLinks(inlineTabWidgets(inlineProtoSections(markdownToHtml(md), refs), md, dir), dir, projQ);
  const files = listViewFiles(dir);
  const nav = files.map(f => {
    const name = path.basename(f);
    const active = f === path.join(dir, mdName) ? ' class="on"' : '';
    return `<a${active} href="/api/prd/view?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(name)}${projQ}">${name}</a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
:root{--bg:#f2f3f5;--card:#fff;--border:#e5e7eb;--text:#1f2329;--t2:#61666d;--a2:#8b5cf6}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);display:flex;height:100vh;overflow:hidden}
.side{width:240px;flex-shrink:0;background:var(--card);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.side-h{padding:14px 16px;font-size:13px;font-weight:700;border-bottom:1px solid var(--border)}
.side-list{flex:1;overflow-y:auto;padding:8px}
.side-list a{display:block;padding:8px 12px;border-radius:7px;font-size:12px;color:var(--t2);text-decoration:none;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-list a:hover{background:#f0f1f3}
.side-list a.on{background:var(--a2);color:#fff}
.side-list a.home{display:flex;align-items:center;gap:7px;padding:9px 13px;margin:2px 0 10px;border-radius:9px;font-size:12px;font-weight:600;color:var(--a2);background:#f5f3ff;border:1px solid #e6e0fa;text-decoration:none;text-align:left;transition:background .15s,color .15s,border-color .15s}
.side-list a.home:hover{background:#ede8fb;color:#7c3aed;border-color:#d8ccf5}
.side-list a.home .arrow{font-size:15px;font-weight:700;line-height:1;transform:translateY(-.5px)}
.main{flex:1;overflow-y:auto;padding:20px 28px}
.doc{max-width:1280px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px 36px;line-height:1.8}
.doc h1{font-size:23px;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid var(--a2)}
.doc h2{font-size:18px;margin:24px 0 10px;padding-left:10px;border-left:4px solid var(--a2)}
.doc h3{font-size:15px;margin:16px 0 8px}
.doc p{margin:8px 0;color:var(--t2)}
.doc ul,.doc ol{margin:8px 0 8px 22px;color:var(--t2)}
.doc li{margin:3px 0}
.doc table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;table-layout:fixed}
.doc th,.doc td{border:1px solid var(--border);padding:7px 10px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
.doc th{background:#f7f8fa;font-weight:600}
.doc td a{word-break:break-all}
.doc code{background:#f4f5f7;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:12px;color:#c7254e}
.doc pre{background:#1f2430;color:#e6e6e6;border-radius:8px;padding:14px 16px;margin:12px 0;overflow-x:auto}
.doc pre code{background:transparent;border:none;color:#e6e6e6}
.code-pre{background:#1e2430 !important;color:#d8dee9;border-radius:8px;padding:16px !important;margin:0 !important;overflow:auto;max-height:calc(100vh - 120px)}
.code-pre code{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre}
.doc blockquote{border-left:4px solid #4a90d9;background:#f7f9fc;padding:8px 14px;margin:10px 0;color:var(--t2);border-radius:0 8px 8px 0}
.doc hr{border:none;border-top:1px solid var(--border);margin:20px 0}
.proto{max-width:1280px;margin:20px auto;background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.proto-head{background:#f7f8fa;padding:10px 16px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border)}
.proto-head code{color:var(--a2)}
.proto-frame{width:100%;height:760px;border:none;display:block}
.muted{color:#a8abb2;font-size:13px;max-width:1280px;margin:0 auto 20px}
.code-tabs{border:1px solid var(--border);border-radius:8px;margin:10px 0;overflow:hidden}
.tabs-head{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--border);background:#f7f8fa}
.tab-btn{padding:7px 16px;font-size:12px;background:transparent;border:none;border-right:1px solid var(--border);cursor:pointer;color:var(--t2);font-weight:600}
.tab-btn:hover{color:var(--a2)}
.tab-btn.active{background:var(--a2);color:#fff}
.tab-panel pre{margin:0;border-radius:0}
.tab-panel iframe.code-frame{width:100%;height:340px;border:none;display:block}
.code-tabs{position:relative}
.tabs-head{display:flex;align-items:center}
.tabs-max{margin-left:auto;border:none;background:transparent;font-size:13px;cursor:pointer;color:var(--t2);padding:2px 12px;line-height:1}
.tabs-max:hover{color:var(--a2)}
.max-overlay{position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column}
.max-head{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f7f8fa;border-bottom:1px solid var(--border);flex-shrink:0}
.max-title{font-size:13px;font-weight:700;color:#1f2329}
.max-close{border:none;background:transparent;font-size:16px;cursor:pointer;color:#61666d;line-height:1}
.max-close:hover{color:#dc2626}
.max-body{flex:1;display:flex;min-height:0}
.max-nav{width:240px;flex-shrink:0;background:#1f2430;overflow-y:auto;padding:8px}
.max-item{display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;color:#a8b2bf;font-size:12px;cursor:pointer;border-radius:6px;margin-bottom:2px;font-family:"SF Mono",Menlo,Consolas,monospace}
.max-item:hover{background:#2a3040;color:#fff}
.max-item.on{background:#8b5cf6;color:#fff}
.max-code{flex:1;min-width:0;background:#1e2430}
.max-code iframe{width:100%;height:100%;border:none;display:block}
</style></head><body>
  <nav class="side">
    <div class="side-h">📄 MD 文件（${files.length}）</div>
    <div class="side-list">${homeNav}${nav}</div>
  </nav>
  <div class="main">
    <div class="doc">${bodyHtml}</div>
  </div>
  <script>mermaid.initialize({startOnLoad:true});
document.querySelectorAll('.code-tabs').forEach(function(t){
  var bs=t.querySelectorAll('.tab-btn'), ps=t.querySelectorAll('.tab-panel');
  bs.forEach(function(b){ b.addEventListener('click',function(){
    bs.forEach(function(x){x.classList.toggle('active',x===b);});
    ps.forEach(function(p){p.hidden=p.getAttribute('data-tab')!==b.getAttribute('data-tab');});
  });});
  // ⛶ 最大化:左文件导航 + 右大代码 iframe
  var ov=t.querySelector('.max-overlay'), mx=t.querySelector('.tabs-max'), frame=t.querySelector('.max-code iframe');
  if(ov&&mx){
    mx.addEventListener('click',function(){ov.hidden=false;});
    var cl=t.querySelector('.max-close');
    if(cl)cl.addEventListener('click',function(){ov.hidden=true;});
    t.querySelectorAll('.max-item').forEach(function(it){
      it.addEventListener('click',function(){
        t.querySelectorAll('.max-item').forEach(function(x){x.classList.toggle('on',x===it);});
        if(frame)frame.src=it.getAttribute('data-url');
      });
    });
  }
});
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ document.querySelectorAll('.max-overlay').forEach(function(o){o.hidden=true;}); } });
</script>
</body></html>`;
}

// ── 路由 ────────────────────────────────────────────────

/** 文件夹列表（名称 / 目录 / 创建日期;来自该项目 prd.yaml） */
router.get('/api/prd/folders', requireProject, (req, res) => {
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
});

/** 某文件夹下的 MD 文件列表 */
router.get('/api/prd/files', (req, res) => {
  const dir = String(req.query.dir || '');
  if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: '目录不存在' });
  const files = listMdFiles(dir).map(f => ({ name: path.basename(f), path: f }));
  res.json({ ok: true, files });
});

/** 切换目录完成状态（针对整个目录;落项目 data/prd-status.json） */
router.post('/api/prd/done', requireProject, (req, res) => {
  const project = reqProject(req);
  const dir = String((req.body as { dir?: unknown })?.dir || '');
  const done = Boolean((req.body as { done?: unknown })?.done);
  if (!dir) return res.status(400).json({ ok: false, error: 'dir is required' });
  setDirDone(project, dir, done);
  res.json({ ok: true, dir, done });
});

/** 内嵌预览：只返回渲染的 MD 内容（doc + 原型 iframe，无左侧导航） */
function renderContentOnly(md: string, dir: string, extraBases: string[], title: string): string {
  const refs = findHtmlRefs(md, dir, extraBases);
  const bodyHtml = inlineTabWidgets(inlineProtoSections(markdownToHtml(md), refs), md, dir);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
:root{--bg:#0d0d10;--card:#131316;--border:#23232a;--text:#c8c8d0;--t2:#8b8b96;--a:#22ee66;--a2:#8b5cf6}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);padding:14px}
.doc{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px 24px;line-height:1.8;font-size:13px}
.doc h1{font-size:20px;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid var(--a2)}
.doc h2{font-size:17px;margin:20px 0 8px;padding-left:8px;border-left:4px solid var(--a2)}
.doc h3{font-size:14px;margin:14px 0 6px}
.doc p{margin:6px 0;color:var(--t2)}
.doc ul,.doc ol{margin:6px 0 6px 20px;color:var(--t2)}
.doc li{margin:2px 0}
.doc table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px;table-layout:fixed}
.doc th,.doc td{border:1px solid var(--border);padding:6px 9px;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:break-word}
.doc th{background:#1a1a1f;font-weight:600}
.doc td a{word-break:break-all}
.doc code{background:#1a1a1f;border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:11px;color:#e08a8a}
.doc pre{background:#1f2430;color:#e6e6e6;border-radius:6px;padding:12px 14px;margin:10px 0;overflow-x:auto}
.doc pre code{background:transparent;border:none;color:#e6e6e6}
.doc blockquote{border-left:4px solid #4499ee;background:#15151a;padding:7px 12px;margin:8px 0;color:var(--t2);border-radius:0 6px 6px 0}
.doc hr{border:none;border-top:1px solid var(--border);margin:16px 0}
.proto{margin:14px 0;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.proto-head{background:#15151a;padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid var(--border)}
.proto-head code{color:var(--a2)}
.proto-frame{width:100%;height:600px;border:none;display:block}
.code-tabs{border:1px solid var(--border);border-radius:8px;margin:10px 0;overflow:hidden}
.tabs-head{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--border);background:#15151a}
.tab-btn{padding:7px 16px;font-size:12px;background:transparent;border:none;border-right:1px solid var(--border);cursor:pointer;color:var(--t2);font-weight:600}
.tab-btn:hover{color:var(--a2)}
.tab-btn.active{background:var(--a2);color:#fff}
.tab-panel pre{margin:0;border-radius:0}
.tab-panel iframe.code-frame{width:100%;height:340px;border:none;display:block}
.code-tabs{position:relative}
.tabs-head{display:flex;align-items:center}
.tabs-max{margin-left:auto;border:none;background:transparent;font-size:13px;cursor:pointer;color:var(--t2);padding:2px 12px;line-height:1}
.tabs-max:hover{color:var(--a2)}
.max-overlay{position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column}
.max-head{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f7f8fa;border-bottom:1px solid var(--border);flex-shrink:0}
.max-title{font-size:13px;font-weight:700;color:#1f2329}
.max-close{border:none;background:transparent;font-size:16px;cursor:pointer;color:#61666d;line-height:1}
.max-close:hover{color:#dc2626}
.max-body{flex:1;display:flex;min-height:0}
.max-nav{width:240px;flex-shrink:0;background:#1f2430;overflow-y:auto;padding:8px}
.max-item{display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;color:#a8b2bf;font-size:12px;cursor:pointer;border-radius:6px;margin-bottom:2px;font-family:"SF Mono",Menlo,Consolas,monospace}
.max-item:hover{background:#2a3040;color:#fff}
.max-item.on{background:#8b5cf6;color:#fff}
.max-code{flex:1;min-width:0;background:#1e2430}
.max-code iframe{width:100%;height:100%;border:none;display:block}
</style></head><body>
  <div class="doc">${bodyHtml}</div>
  <script>mermaid.initialize({startOnLoad:true});
document.querySelectorAll('.code-tabs').forEach(function(t){
  var bs=t.querySelectorAll('.tab-btn'), ps=t.querySelectorAll('.tab-panel');
  bs.forEach(function(b){ b.addEventListener('click',function(){
    bs.forEach(function(x){x.classList.toggle('active',x===b);});
    ps.forEach(function(p){p.hidden=p.getAttribute('data-tab')!==b.getAttribute('data-tab');});
  });});
  // ⛶ 最大化:左文件导航 + 右大代码 iframe
  var ov=t.querySelector('.max-overlay'), mx=t.querySelector('.tabs-max'), frame=t.querySelector('.max-code iframe');
  if(ov&&mx){
    mx.addEventListener('click',function(){ov.hidden=false;});
    var cl=t.querySelector('.max-close');
    if(cl)cl.addEventListener('click',function(){ov.hidden=true;});
    t.querySelectorAll('.max-item').forEach(function(it){
      it.addEventListener('click',function(){
        t.querySelectorAll('.max-item').forEach(function(x){x.classList.toggle('on',x===it);});
        if(frame)frame.src=it.getAttribute('data-url');
      });
    });
  }
});
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ document.querySelectorAll('.max-overlay').forEach(function(o){o.hidden=true;}); } });
</script>
</body></html>`;
}

/** 内嵌预览接口（无左侧导航，用于右侧预览 div iframe;prd.yaml.dir 作原型 extraBase 参考） */
router.get('/api/prd/content', (req, res) => {
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
});

/** 双栏查看页：左 文件列表（md + 伪代码文件）+ 右渲染 HTML */
router.get('/api/prd/view', (req, res) => {
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
});

/** 读取原型 HTML 文件（供 iframe 引用） */
// ⭐2026-08-30 根治:路径式路由 /api/prd/file/<绝对路径> —— iframe 页面内的相对引用(../shared/xx.css)
// 按 URL 目录正确解析(query 形式 p= 无法承载目录上下文,相对引用会解析到 /shared/... 兜底 300B 假响应)
function sendPrdFile(p: string, res: any) {
  if (!fs.existsSync(p)) return res.status(404).send('not found');
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
router.get('/api/prd/file/*splat', (req, res) => {
  const segs = Array.isArray(req.params.splat) ? req.params.splat : [req.params.splat];
  sendPrdFile('/' + segs.map(decodeURIComponent).join('/'), res);   // ⭐express5 splat 是分段数组
});
router.get('/api/prd/file', (req, res) => {
  sendPrdFile(String(req.query.p || ''), res);
});

/** 读取伪代码文件（供 Tab iframe 嵌套） */
router.get('/api/prd/code-file/*splat', (req, res) => {
  const segs = Array.isArray(req.params.splat) ? req.params.splat : [req.params.splat];
  codeFileHandler('/' + segs.map(decodeURIComponent).join('/'), res);
});
router.get('/api/prd/code-file', (req, res) => {
  codeFileHandler(String(req.query.p || ''), res);
});
function codeFileHandler(p: string, res: any) {
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  const content = fs.readFileSync(p, 'utf-8')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#1e2430;color:#d8dee9;font:12px/1.6 "SF Mono",Menlo,Consolas,monospace;padding:12px 14px}pre{margin:0;white-space:pre-wrap;word-break:break-all}</style>
</head><body><pre>${content}</pre></body></html>`);
}

export default router;
