// ── 项目注册表封装 + .code-panel 骨架 + 模块 YAML / 运行时数据读写 ──

import fs from 'fs';
import path from 'path';
import type { ProjectRow } from '../db/global-store';
import { projectEnvVars, interpolateEnvVars } from '../env/env-store';
import {
  listProjects, getProject, addProject, updateProject, deleteProject,
} from '../db/global-store';
import { projectCodePanelDir, projectDataDir, projectModuleYamlFile, projectDataFile } from '../paths';

/** 名字 → id:小写、非字母数字(保留中文)折叠为 '-',供仓库 id 等生成 */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}
import {
  ensureDefaultYaml, loadModuleYaml, writeModuleYaml,
} from './yaml';
import type { ModuleName, ModuleYaml } from './yaml';

// ── 注册表(薄封装) ─────────────────────────────────────

export function allProjects(): ProjectRow[] { return listProjects(); }
export function removeProject(id: string): void { deleteProject(id); }

export interface CreateProjectInput {
  name: string;
  root: string;
  note?: string;
}

/** 下一个整型自增项目 id(现有个数内取 max+1;无视非数字 id) */
function nextProjectId(): string {
  const max = listProjects().reduce<number>((m, p) => {
    const n = parseInt(p.id, 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return String(max + 1);
}

export function createProject(input: CreateProjectInput): ProjectRow {
  if (!input.name || !input.name.trim()) throw new Error('name 必填');
  const root = path.resolve(input.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`项目根目录不存在或不是目录: ${root}`);
  }
  const id = nextProjectId();
  const project = addProject(id, input.name.trim(), root, (input.note || '').trim());
  ensureProjectSkeleton(project);
  return project;
}

export function renameProject(id: string, updates: { name?: string; root?: string; note?: string }): ProjectRow {
  const p = updateProject(id, updates);
  return p;
}

/** .code-panel/README.md —— 给本项目目录里的 AI/人看,照着模板添加即可 */
const README_TEMPLATE = `# .code-panel —— 本项目在 code-panel 面板里的配置

面板按本项目读取此目录;**修改即生效**,无需重启面板。

> 📐 **路径规则:一律写「相对项目根的相对路径」**(如 code/backend/apps/main/logs/a.log),
> 面板读取时自动转成绝对路径;这样本目录可随仓库换机器/换目录直接用。
> 仅当目标确在项目根之外时才用绝对路径(但那样的路径不随仓库迁移)。

## 文件说明
| 文件 | 作用 | 想加什么就编辑它 |
|------|------|------------------|
| \`apps.yaml\`      | 应用服务日志(面板 Apps,/log) | 加平台/应用:backend/frontend + 日志文件/端口/启停(旧 logs.yaml 兼容) |
| \`sql.yaml\`       | 数据库连接(面板 /sql) | 加连接:mysql/sqlite 均支持 |
| \`prd.yaml\`       | PRD 目录(面板 /prd)   | 加 PRD 文档目录 {name,dir} |
| \`git.yaml\`       | git 仓库(面板 /git)   | 加本机 git 仓库 {id,name,path} |
| \`commands.yaml\`  | 命令抽屉「自定义命令」 | 加启动/停止/单模块命令按钮(见下) |
| \`links.yaml\`     | 快捷方式(/log 顶栏 🔗) | 加分组 quick links:group→items→多 urls(标签/域名) |
| \`uploads/\`       | ☁ 上传目录:浏览器传上来的文件 | 面板 ☁ 上传;文件绝对路径发给终端/AI 用 |
| \`downloads/\`     | ☁ 下载目录:AI 产物交付区 | AI/命令写文档进这里,用户在面板 ☁ ⬇ 下载拿回 |
| \`data/\`          | 运行时数据(SQL 历史/队列、PRD 完成态、tmux 备注;cloud-config.json 存云目录覆盖) | 面板自动写,勿手改 |

每个 yaml 文件顶部注释就是完整字段说明 + 示例(把注释里的例子打开就能用)。

## 自定义命令 commands.yaml
提交式、随仓库走,仓库里的 AI 照 \`commands.yaml\` 顶部注释即可为这个项目加启动/停止按钮。
面板「命令终端」抽屉会读到它;新增 id 取唯一值即可。
`;

/** 生成/补齐 .code-panel 骨架(.gitignore + README + 6 个模块默认 yaml(apps/sql/prd/git/commands/links)+ uploads/downloads + data/)。
 *  幂等:已有内容不覆盖,只补齐缺失文件/目录。 */
export function ensureProjectSkeleton(project: ProjectRow): void {
  const dir = projectCodePanelDir(project.root);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dataDir = projectDataDir(project.root);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  // ☁ 上传/下载目录:加项目即建好(AI/命令可立即往里读写文件;空目录不随 git 提交无妨)
  for (const sub of ['uploads', 'downloads']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // .gitignore 幂等保证含 data/ uploads/ downloads/(运行时数据 + 云上传下载目录都不进仓库)
  const gitignore = path.join(dir, '.gitignore');
  const want = ['data/', 'uploads/', 'downloads/'];
  const prev = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  const missing = want.filter((l) => !prev.split('\n').some((x) => x.trim() === l));
  if (missing.length) fs.writeFileSync(gitignore, (prev ? prev.replace(/\n?$/, '\n') : '') + missing.join('\n') + '\n', 'utf8');

  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README_TEMPLATE, 'utf8');

  for (const m of ['logs', 'sql', 'prd', 'git', 'commands', 'links', 'redis'] as ModuleName[]) {
    // logs 已写 apps.yaml(新)或还留着旧 logs.yaml(兼容)时,不再生成空 apps.yaml
    if (m === 'logs') {
      const apps = projectModuleYamlFile(project.root, 'logs');
      const legacy = path.join(projectCodePanelDir(project.root), 'logs.yaml');
      if (fs.existsSync(apps) || fs.existsSync(legacy)) continue;
    }
    ensureDefaultYaml(projectModuleYamlFile(project.root, m), m);
  }
}

/** 读取/切换前补齐骨架:缺目录建目录、缺模板补模板;已有内容不覆盖 */
function ensureScaffolded(project: ProjectRow): void {
  ensureProjectSkeleton(project);
}

// ── 模块 YAML ──────────────────────────────────────────

// ── 路径规则:配置文件里只写「相对项目根」的路径 ───────────
//   读取时 → 绝对(供面板/命令用);保存时 → 若在项目根内则存相对。
//   项目根之外的特殊路径仍容忍(保留绝对),但不会随仓库迁移。
function absOf(root: string, p: unknown): string | undefined {
  if (typeof p !== 'string' || !p.trim()) return undefined;
  const v = p.trim();
  return path.isAbsolute(v) ? v : path.resolve(root, v);
}
function relOf(root: string, p: unknown): string | undefined {
  if (typeof p !== 'string' || !p.trim()) return undefined;
  const v = p.trim();
  if (!path.isAbsolute(v)) return v;
  const r = path.relative(root, v);
  if (r.startsWith('..')) return v;            // 根外特殊路径:保留绝对(不随仓库迁移)
  return r === '' ? '.' : r;                   // 根本身存 '.',其余相对
}
/** 顶层数组字段 → 模块 的映射(读/写两侧共用;logs 嵌套结构单独走,不进本表) */
const ARRAY_FIELDS: Partial<Record<ModuleName, string[]>> = {
  sql: ['connections'],
  prd: ['folders'],
  git: ['repos'],
  commands: ['commands'],
};

type PathConv = (root: string, p: unknown) => string | undefined;

/** 对单个条目对象做 file/path/dir/cwd 字段转换(原地) */
function walkFields(root: string, v: Record<string, unknown>, conv: PathConv): void {
  if (!v) return;
  for (const f of ['file', 'path', 'dir', 'cwd']) {
    if (typeof v[f] === 'string') v[f] = conv(root, v[f]) as string;
  }
}

/** 模块级路径转换(abs/rel 由 conv 决定):logs 嵌套 + 表驱动数组 + prd.dir 特例 */
function transformModule(root: string, module: ModuleName, yaml: Record<string, unknown>, conv: PathConv): void {
  if (module === 'logs') {
    for (const s of (yaml.sections as Record<string, unknown>[] | undefined) ?? []) {
      for (const l of (s.logs as Record<string, unknown>[] | undefined) ?? []) walkFields(root, l, conv);
    }
    for (const pf of (yaml.platforms as Record<string, unknown>[] | undefined) ?? []) {
      for (const l of (pf.backend as Record<string, unknown>[] | undefined) ?? []) walkFields(root, l, conv);
      for (const l of (pf.frontend as Record<string, unknown>[] | undefined) ?? []) walkFields(root, l, conv);
    }
    return;
  }
  if (module === 'prd' && typeof yaml.dir === 'string') yaml.dir = conv(root, yaml.dir) || '';
  for (const key of ARRAY_FIELDS[module] ?? []) {
    const arr = yaml[key];
    if (Array.isArray(arr)) for (const item of arr as Record<string, unknown>[]) walkFields(root, item, conv);
  }
}

/** apps.yaml 优先;缺失但有旧 logs.yaml 时读旧文件(向后兼容) */
function logsYamlFile(root: string): string {
  const dir = projectCodePanelDir(root);
  const apps = path.join(dir, 'apps.yaml');
  const legacy = path.join(dir, 'logs.yaml');
  return fs.existsSync(apps) ? apps : (fs.existsSync(legacy) ? legacy : apps);
}

export function loadProjectModule(project: ProjectRow, module: ModuleName, opts?: { raw?: boolean }): ModuleYaml {
  ensureScaffolded(project);
  const root = project.root;
  const file = module === 'logs' ? logsYamlFile(root) : projectModuleYamlFile(root, module);
  let yaml = loadModuleYaml<ModuleYaml>(file, module) as any;
  // 通用 ${VAR:default} 环境变量插值(2026-09-09):所有模块读入内存默认展开,
  //   变量 = 项目当前环境组(envs.yaml)+ 进程 env;envs.yaml 本身不经此处(变量源)。
  //   写盘路径(upsert/delete/yaml 回显)必须传 {raw:true},防占位符被固化进 yaml。
  if (!opts?.raw) {
    yaml = interpolateEnvVars(yaml, projectEnvVars(project));
  }
  transformModule(root, module, yaml, absOf);
  return yaml as ModuleYaml;
}

export function saveProjectModule(project: ProjectRow, module: ModuleName, value: ModuleYaml): void {
  ensureScaffolded(project);
  const root = project.root;
  const v = value as Record<string, unknown>;
  transformModule(root, module, v, relOf);
  writeModuleYaml(projectModuleYamlFile(project.root, module), v);
}

// ── 项目运行时数据(.code-panel/data/,gitignore) ────────

export function readRuntimeJson<T>(project: ProjectRow, rel: string, fallback: T): T {
  ensureScaffolded(project);
  const file = projectDataFile(project.root, rel);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    console.warn(`[runtime] 读取失败回退默认(${file}):`, (e as Error).message);
    return fallback;
  }
}

export function writeRuntimeJson(project: ProjectRow, rel: string, value: unknown): void {
  ensureScaffolded(project);
  const file = projectDataFile(project.root, rel);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}
