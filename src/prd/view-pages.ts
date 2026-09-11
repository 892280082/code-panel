// ── PRD 查看页组装(整页 HTML:双栏查看页 / 内嵌预览页)──────
//   原型 iframe 内联、伪代码 Tab 组件、正文链接改写;
//   亮/暗两套主题共用 Tab 组件样式与交互脚本(原先两处各复制一份)。

import fs from 'fs';
import path from 'path';
import type { PrdModuleYaml } from '../projects/yaml';
import { markdownToHtml, esc } from './md-render';

/** 可浏览的代码文件扩展名（伪代码目录等） */
export const CODE_EXTS = ['.ts', '.js', '.jsx', '.tsx', '.java', '.sql', '.py', '.json', '.yaml', '.yml', '.sh', '.go', '.vue'];

/** 视图导航文件列表：md + 代码文件（伪代码目录能看到所有步骤文件） */
export function listViewFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  // 2026-09-11 递归列子目录(计划文档在 plan/{todo,doing,done}/ 下,只扫一层永远看不见;
  // 跳过软链防绕环,深度≤4)。显示名 = 相对 dir 的路径(plan/doing/plan-02-xx.md)。
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (e.name.endsWith('.md') || CODE_EXTS.includes(ext)) out.push(p);
    }
  };
  walk(dir, 0);
  return out.sort();
}

// ── 原型引用 ─────────────────────────────────────────────

function findHtmlRefs(md: string, baseDir: string, extraBases: string[] = []): { name: string; url: string }[] {
  const refs: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /([A-Za-z0-9_\-\/\.\\一-鿿]+\.html)/g;
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
  h += `<div class="max-overlay">
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

// ── Tab 组件共享样式/脚本(亮暗两页原先各复制一份,仅 tabs-head 背景一色之差)──

const TAB_WIDGET_CSS = (headBg: string) => `
.code-tabs{border:1px solid var(--border);border-radius:8px;margin:10px 0;overflow:hidden}
.tabs-head{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--border);background:${headBg}}
.tab-btn{padding:7px 16px;font-size:12px;background:transparent;border:none;border-right:1px solid var(--border);cursor:pointer;color:var(--t2);font-weight:600}
.tab-btn:hover{color:var(--a2)}
.tab-btn.active{background:var(--a2);color:#fff}
.tab-panel pre{margin:0;border-radius:0}
.tab-panel iframe.code-frame{width:100%;height:340px;border:none;display:block}
.code-tabs{position:relative}
.tabs-head{display:flex;align-items:center}
.tabs-max{margin-left:auto;border:none;background:transparent;font-size:13px;cursor:pointer;color:var(--t2);padding:2px 12px;line-height:1}
.tabs-max:hover{color:var(--a2)}
.max-overlay{position:fixed;inset:0;z-index:9999;background:#fff;display:none;flex-direction:column}
.max-overlay.open{display:flex}
.max-head{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f7f8fa;border-bottom:1px solid var(--border);flex-shrink:0}
.max-title{font-size:13px;font-weight:700;color:#1f2329}
.max-close{border:none;background:transparent;font-size:16px;cursor:pointer;color:#61666d;line-height:1}
.max-close:hover{color:#dc2626}
.max-body{flex:1;display:flex;min-height:0}
.max-nav{width:240px;flex-shrink:0;background:#fff;border-right:1px solid var(--border);overflow-y:auto;padding:8px}
.max-item{display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;color:#3a3f47;font-size:12px;cursor:pointer;border-radius:6px;margin-bottom:2px;font-family:"SF Mono",Menlo,Consolas,monospace}
.max-item:hover{background:#f0f1f3;color:#1f2329}
.max-item.on{background:#8b5cf6;color:#fff}
.max-code{flex:1;min-width:0;background:#fff}
.max-code iframe{width:100%;height:100%;border:none;display:block}`;

const TAB_WIDGET_JS = `<script>mermaid.initialize({startOnLoad:true});
document.querySelectorAll('.code-tabs').forEach(function(t){
  var bs=t.querySelectorAll('.tab-btn'), ps=t.querySelectorAll('.tab-panel');
  bs.forEach(function(b){ b.addEventListener('click',function(){
    bs.forEach(function(x){x.classList.toggle('active',x===b);});
    ps.forEach(function(p){p.hidden=p.getAttribute('data-tab')!==b.getAttribute('data-tab');});
  });});
  // ⛶ 最大化:左文件导航 + 右大代码 iframe
  var ov=t.querySelector('.max-overlay'), mx=t.querySelector('.tabs-max'), frame=t.querySelector('.max-code iframe');
  if(ov&&mx){
    mx.addEventListener('click',function(){ov.classList.add('open');});
    var cl=t.querySelector('.max-close');
    if(cl)cl.addEventListener('click',function(){ov.classList.remove('open');});
    t.querySelectorAll('.max-item').forEach(function(it){
      it.addEventListener('click',function(){
        t.querySelectorAll('.max-item').forEach(function(x){x.classList.toggle('on',x===it);});
        if(frame)frame.src=it.getAttribute('data-url');
      });
    });
  }
});
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ document.querySelectorAll('.max-overlay').forEach(function(o){o.classList.remove('open');}); } });
</script>`;

// ── 整页组装 ─────────────────────────────────────────────

/** 双栏查看页：左 = 该目录 MD 文件列表，右 = 渲染当前 MD + 原型 iframe */
export function buildViewPage(md: string, mdName: string, dir: string, extraBases: string[], title: string, isCode = false, prdCtx?: PrdModuleYaml, projectId?: string): string {
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
  // 2026-09-11 递归列表:导航名/链接用相对路径(plan/doing/plan-02-xx.md),子目录文件可达且不撞名
  const nav = files.map(f => {
    const rel = path.relative(dir, f);
    const active = f === path.resolve(dir, mdName) ? ' class="on"' : '';
    return `<a${active} href="/api/prd/view?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(rel)}${projQ}">${rel}</a>`;
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
.muted{color:#a8abb2;font-size:13px;max-width:1280px;margin:0 auto 20px}${TAB_WIDGET_CSS('#f7f8fa')}
</style></head><body>
  <nav class="side">
    <div class="side-h">📄 MD 文件（${files.length}）</div>
    <div class="side-list">${homeNav}${nav}</div>
  </nav>
  <div class="main">
    <div class="doc">${bodyHtml}</div>
  </div>
  ${TAB_WIDGET_JS}
</body></html>`;
}

/** 内嵌预览：只返回渲染的 MD 内容（doc + 原型 iframe，无左侧导航） */
export function renderContentOnly(md: string, dir: string, extraBases: string[], title: string): string {
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
.proto-frame{width:100%;height:600px;border:none;display:block}${TAB_WIDGET_CSS('#15151a')}
</style></head><body>
  <div class="doc">${bodyHtml}</div>
  ${TAB_WIDGET_JS}
</body></html>`;
}
