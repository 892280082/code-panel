// ── Markdown → HTML 片段(纯函数,无 fs)──────────────────
//   自包含转换器:标题/列表/表格(语义列宽)/代码块/mermaid/引用/伪代码 Tab。
//   被 view-pages(整页组装)与 file-serve 依赖;esc 供各处 HTML 转义复用。

export function esc(s: string): string {
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
