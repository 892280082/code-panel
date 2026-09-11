// ── v2 需求中心看板生成器(<项目根>/.code-panel/prd/<人名>/index.md)─────
//   2026-09-11 用户定:脚本归渲染引擎(code-panel)管,skill 只调用 —— 原 design-prd
//   skill 里的 gen_board.py 本文件等价移植(TS),三个消费方共用一个实现:
//     · 路由  POST /api/prd/gen-board(前端 ↻ Refresh 按钮)
//     · AI    cp post /api/prd/gen-board -d '{"project":<id>}'(本机免密)
//   结构统一铁律:每个人中心的看板都由本程序渲染,结构一模一样。
//   列:计划 | 内容 | 伪代码 | spec | 评审 | 状态
//     - 内容  = 计划文档 `> 主题:` 行(缺省取「一、目标一句话」首行)
//     - 伪代码 = 步骤书(plan/ 或 plan/pseudocode/ 下 plan-NN-伪代码/index.md;存量单文件 plan-NN-伪代码.md 兼容)
//              + 原型 plan-NN-*.html(plan/ 与 pseudocode/ 同扫)+ 核心实现(plan/pseudocode/plan-NN-核心实现[/index.md|.md])
//     - spec  = 计划文档全部 `> spec 访问:[t](u)` 行 → [spec](u) / [spec①][spec②]
//     - 评审  = 计划文档 `## 评审` 章节最后一条(最新),展示前 50 字
//     - 状态  = 目录(todo ⏳ / doing 🔄)+ done 的 `> 归档:` 日期
//   整份生成:index.md 100% 由程序输出;手写内容一律放 notes.md(首次接管自动迁移)。

import fs from 'fs';
import path from 'path';

const EMPTY_ROW = '| — | — | — | — | — | — |';
const HEADERS = '| 计划 | 内容 | 伪代码 | spec | 评审 | 状态 |\n|---|---|---|---|---|---|\n';
const REVIEW_LIMIT = 50;
const STATE_MAP: Record<string, string> = { todo: '⏳ 待启动', doing: '🔄 进行中', done: '✅ 已完成' };
/** --all 遍历时排除:规范目录 / 里程碑 / 软链(specs 等非人名中心) */
const EXCLUDED_CENTERS = new Set(['原型规范', '总进度', 'specs']);

// ── 单个计划解析 ─────────────────────────────────────────

interface PlanRow {
  nn: string; title: string; content: string; pseudo: string;
  spec: string; review: string; state: string; sort: number;
}

/** 计划文档锚点解析:主题 / spec 访问 / 评审最新一条 / 归档日期 */
function parsePlan(md: string, statusDir: string, prdDir: string): PlanRow {
  const text = fs.readFileSync(md, 'utf8');
  const stem = path.basename(md, '.md');
  const m = stem.match(/plan-(\d+)/);
  const nn = m ? m[1] : stem;

  // 内容:主题行 → 一、目标一句话首行 → H1 标题(剥状态前缀)→ 文件名
  // ⚠️ 2026-09-11 补 H1 兜底:存量 33 份计划文档全无主题行/目标节,此前内容列全渲染「(见计划文档)」
  let theme = '';
  const mt = text.match(/^>\s*主题:\s*(.*)$/m);
  if (mt) theme = mt[1].trim();
  if (!theme) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## 一、目标一句话')) {
        const rest = lines.slice(i + 1).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        theme = rest[0] ?? '';
        break;
      }
    }
  }
  if (!theme) {
    const mh = text.match(/^#\s+(.+)$/m);
    if (mh) {
      theme = mh[1].trim()
        .replace(/^(待办计划|进行中计划|当前开发计划|开发计划)\s*[:：]\s*/, '')
        .replace(/^plan-\d+\s*[:：]?\s*/, '');
    }
  }

  // spec:全部 spec 访问行
  const specs: string[] = [];
  const specRe = /^>\s*spec 访问:\[([^\]]*)\]\(([^)]+)\)/gm;   // 无 $ 锚:行尾可带注解括号(如 2026-09-10 规格化回写说明)
  let sm: RegExpExecArray | null;
  while ((sm = specRe.exec(text)) !== null) specs.push(sm[2]);

  // 评审:## 评审 章节最后一条,前 50 字
  let review = '';
  // ⚠️ 2026-09-11 修:`\Z` 是 Python 写法,JS 里被当字面量 "Z" → 评审列永远为空;改标准「串尾」断言
  const sec = text.match(/^## 评审\s*$(.*?)(?=^## |(?![\s\S]))/ms);
  if (sec) {
    const entries = sec[1].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    if (entries.length) {
      const last = entries[entries.length - 1];
      review = last.slice(0, REVIEW_LIMIT) + (last.length > REVIEW_LIMIT ? '…' : '');
    }
  }

  // 伪代码:步骤书/单文件伪代码 + 原型 + 核心实现
  // ⚠️ 2026-09-11 修:原逻辑只认 plan/ 根目录形式 → pseudocode/ 下目录与存量单文件(38/39 等)整列全 —;
  //   三形态 = plan/plan-NN-伪代码/(根,活跃)/ plan/pseudocode/plan-NN-伪代码/(目录)/ plan/pseudocode/plan-NN-伪代码.md(老式单文件)
  const pseudo: string[] = [];
  const planRoot = path.join(prdDir, 'plan');
  const pseudoRoot = path.join(planRoot, 'pseudocode');
  const nnPad = `plan-${nn}`;
  if (fs.existsSync(path.join(planRoot, nnPad + '-伪代码', 'index.md')))
    pseudo.push(`[步骤书](plan/${nnPad}-伪代码/index.md)`);
  else if (fs.existsSync(path.join(pseudoRoot, nnPad + '-伪代码', 'index.md')))
    pseudo.push(`[步骤书](plan/pseudocode/${nnPad}-伪代码/index.md)`);
  else if (fs.existsSync(path.join(pseudoRoot, nnPad + '-伪代码.md')))
    pseudo.push(`[伪代码](plan/pseudocode/${nnPad}-伪代码.md)`);
  // 核心实现(归档产物,目录/单文件;SKILL 契约「与伪代码目录配对,看板自动出链接」)
  if (fs.existsSync(path.join(pseudoRoot, nnPad + '-核心实现', 'index.md')))
    pseudo.push(`[核心实现](plan/pseudocode/${nnPad}-核心实现/index.md)`);
  else if (fs.existsSync(path.join(pseudoRoot, nnPad + '-核心实现.md')))
    pseudo.push(`[核心实现](plan/pseudocode/${nnPad}-核心实现.md)`);
  // 原型 html:plan/ 根与 pseudocode/ 同扫
  for (const dir of [planRoot, pseudoRoot]) {
    const base = dir === planRoot ? 'plan' : 'plan/pseudocode';
    for (const html of listDir(dir).filter(f => f.startsWith(nnPad + '-') && f.endsWith('.html')).sort()) {
      const label = html.slice(nnPad.length + 1, -'.html'.length);   // 去 `plan-NN-` 前缀与 .html 后缀
      pseudo.push(`[${label}](${base}/${html})`);
    }
  }

  const archiveLine = text.split('\n').find(l => l.startsWith('> 归档:')) ?? '';
  let state = STATE_MAP[statusDir] ?? statusDir;
  if (statusDir === 'done' && archiveLine) state += '(' + archiveLine.replace('> 归档:', '').trim() + ')';

  return {
    nn,
    title: `[\`${stem}\`](plan/${statusDir}/${path.basename(md)})`,
    content: theme.length > 120 ? theme.slice(0, 120) + '…' : (theme || '(见计划文档)'),
    pseudo: pseudo.length ? pseudo.join(' · ') : '—',
    spec: specCell(specs),
    review: review || '—',
    state,
    sort: /^\d+$/.test(nn) ? parseInt(nn, 10) : 999,
  };
}

/** spec 链接换算:/demo-v2-specs/{目录}/… → specs/{目录}/spec.md(依赖中心内软链,渲染器才给返回按钮) */
function specCell(specs: string[]): string {
  if (!specs.length) return '—';
  const link = (u: string): string => {
    const m = u.match(/\/demo-v2-specs\/([^/]+)/);
    return m ? `specs/${m[1]}/spec.md` : u;
  };
  if (specs.length === 1) return `[spec](${link(specs[0])})`;
  return specs.map((u, i) => `[spec${String.fromCodePoint(0x2460 + i)}](${link(u)})`).join(' ');
}

function row(p: PlanRow): string {
  return `| ${p.title} | ${p.content} | ${p.pseudo} | ${p.spec} | ${p.review} | ${p.state} |`;
}

function table(plans: PlanRow[]): string {
  if (!plans.length) return HEADERS + EMPTY_ROW;
  return HEADERS + plans.sort((a, b) => a.sort - b.sort).map(row).join('\n');
}

// ── 组装 / 落盘 ──────────────────────────────────────────

function build(prdDir: string): string {
  const plans: Record<'todo' | 'doing' | 'done', PlanRow[]> = { todo: [], doing: [], done: [] };
  for (const st of Object.keys(plans) as Array<keyof typeof plans>) {
    const d = path.join(prdDir, 'plan', st);
    if (fs.existsSync(d)) {
      plans[st] = listDir(d).filter(f => /^plan-.*\.md$/.test(f)).sort().map(f => parsePlan(path.join(d, f), st, prdDir));
    }
  }
  const names = (lst: PlanRow[]): string =>
    lst.length ? '(' + lst.map(p => `plan-${p.nn}`).join(' / ') + ')' : '';
  const stats = `> 计划:待启动 **${plans.todo.length}**${names(plans.todo)}`
    + `· 执行中 **${plans.doing.length}**${names(plans.doing)}`
    + `· 已完成 **${plans.done.length}**${names(plans.done)}`;
  return [
    '## 📊 进度统计', '', stats, '',
    '## 📋 当前计划(进行中)', '', table(plans.doing), '',
    '## 📅 计划列表(待启动)', '', table(plans.todo), '',
    '## 📂 已完成', '', table(plans.done), '',
  ].join('\n');
}

function ensureSkeleton(prdDir: string): void {
  for (const st of ['todo', 'doing', 'done']) {
    fs.mkdirSync(path.join(prdDir, 'plan', st), { recursive: true });
  }
}

/** 列目录文件名(仅普通文件,不存在返回空) */
function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
  } catch { return []; }
}

/** 渲染一个中心(整份重写 index.md;首次接管把旧内容迁入 notes.md,手写内容零丢失) */
function processCenter(prdDir: string, init: boolean): string {
  const idx = path.join(prdDir, 'index.md');
  const notes = path.join(prdDir, 'notes.md');
  if (!fs.existsSync(idx) && !init) {
    return `⚠ ${path.basename(prdDir)}/index.md 不存在(init 可生成骨架)`;
  }
  ensureSkeleton(prdDir);
  let migrated = false;
  if (fs.existsSync(idx) && !fs.existsSync(notes)) {
    const old = fs.readFileSync(idx, 'utf8').trim();
    if (old) {
      fs.writeFileSync(notes,
        '# 手写备注(notes.md)\n\n'
        + '> 本文件 = 该中心的 AI 区/手写区(总结、里程碑、叙事),看板生成器永不覆盖;看板首页有入口链接。\n\n'
        + old + '\n', 'utf8');
      migrated = true;
    }
  }
  const name = path.basename(prdDir);
  const header = [
    `# ${name} 的需求看板`, '',
    '> **状态 = 目录位置**:计划放 `plan/todo/`(待启动)/ `plan/doing/`(进行中)/ `plan/done/`(已完成),移动文件即流转。',
    '> **看板 = 程序渲染**(code-panel 内置生成器,全中心结构统一;本文件整份由程序输出,勿手改 —— 手写内容写 [notes.md](notes.md))。',
    '> **列说明**:内容 = 计划文档 `> 主题:` 行(缺省依次取「一、目标一句话」首行 / H1 标题);伪代码 = 步骤书/单文件伪代码 + 原型 + 核心实现;spec = `> spec 访问:` 行(跳规格化目录);'
      + '评审 = 计划文档 `## 评审` 章节最新一条前 50 字(评审人把意见写进计划文档即可)。',
    '',
  ].join('\n');
  fs.writeFileSync(idx, header + '\n' + build(prdDir), 'utf8');
  return `✅ ${name} 看板已整份重绘` + (migrated ? '(旧内容已迁入 notes.md)' : '');
}

// ── 对外入口 ─────────────────────────────────────────────

/** 全部人名中心重绘(= 原 gen_board.py --all);返回逐中心结果行 */
export function genAllBoards(projectRoot: string): string[] {
  const prdRoot = path.join(projectRoot, '.code-panel', 'prd');
  if (!fs.existsSync(prdRoot)) throw new Error(`项目无需求中心目录:${prdRoot}`);
  const out: string[] = [];
  for (const ent of fs.readdirSync(prdRoot, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
    if (EXCLUDED_CENTERS.has(ent.name)) continue;
    out.push(processCenter(path.join(prdRoot, ent.name), true));   // 全量一律接管
  }
  return out;
}

/** 单中心重绘(= 原 --prd);保留给特殊场景,常规走 genAllBoards */
export function genBoard(prdDir: string, init = true): string {
  return processCenter(prdDir, init);
}
