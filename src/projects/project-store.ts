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
export function projectById(id: string): ProjectRow | undefined { return getProject(id); }
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
function walkAbs(root: string, v: any): any {
  if (!v) return v;
  for (const f of ['file', 'path', 'dir', 'cwd']) if (typeof v[f] === 'string') v[f] = absOf(root, v[f]);
  return v;
}
function walkRel(root: string, v: any): any {
  if (!v) return v;
  for (const f of ['file', 'path', 'dir', 'cwd']) if (typeof v[f] === 'string') v[f] = relOf(root, v[f]);
  return v;
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
  if (module === 'logs') {
    // platforms(新格式)+ sections(旧格式)里每个服务项的 file/start 等一律补绝对
    for (const s of yaml.sections ?? []) for (const l of s.logs ?? []) walkAbs(root, l);
    for (const p of yaml.platforms ?? []) { for (const l of p.backend ?? []) walkAbs(root, l); for (const l of p.frontend ?? []) walkAbs(root, l); }
  }
  else if (module === 'sql') (yaml.connections || []).forEach((c: any) => walkAbs(root, c));
  else if (module === 'prd') { if (typeof yaml.dir === 'string') yaml.dir = absOf(root, yaml.dir) || ''; (yaml.folders || []).forEach((f: any) => walkAbs(root, f)); }
  else if (module === 'git') (yaml.repos || []).forEach((r: any) => walkAbs(root, r));
  else if (module === 'commands') (yaml.commands || []).forEach((c: any) => walkAbs(root, c));
  return yaml as ModuleYaml;
}

export function saveProjectModule(project: ProjectRow, module: ModuleName, value: ModuleYaml): void {
  ensureScaffolded(project);
  const root = project.root;
  const v = value as any;
  if (module === 'logs') {
    for (const s of v.sections ?? []) for (const l of s.logs ?? []) walkRel(root, l);
    for (const p of v.platforms ?? []) { for (const l of p.backend ?? []) walkRel(root, l); for (const l of p.frontend ?? []) walkRel(root, l); }
  }
  else if (module === 'sql') (v.connections || []).forEach((c: any) => walkRel(root, c));
  else if (module === 'prd') { if (typeof v.dir === 'string') v.dir = relOf(root, v.dir) || ''; (v.folders || []).forEach((f: any) => walkRel(root, f)); }
  else if (module === 'git') (v.repos || []).forEach((r: any) => walkRel(root, r));
  else if (module === 'commands') (v.commands || []).forEach((c: any) => walkRel(root, c));
  writeModuleYaml(projectModuleYamlFile(project.root, module), v);
}

// ── 项目运行时数据(.code-panel/data/,gitignore) ────────

export function projectRuntimePath(project: ProjectRow, rel: string): string {
  return projectDataFile(project.root, rel);
}

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
