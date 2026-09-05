// ── 项目模块 YAML 的读写与类型(logs/sql/prd/git 一模块一文件) ──
//   文件缺失/解析失败一律回退默认空结构,绝不抛错打死接口。

import fs from 'fs';
import yaml from 'js-yaml';
import type { DbConnection } from '../types';

// ── 类型 ────────────────────────────────────────────────

/** logs.yaml:按 sections 分组展示(仅 UI 用途;项目级不再有全局 group) */
export interface LogsModuleYaml {
  sections: { name: string; logs: { name: string; file: string; port?: number }[] }[];
}

/** sql.yaml:本项目数据库连接(group 字段废弃,不再使用) */
export interface SqlModuleYaml {
  connections: DbConnection[];
}

/** prd.yaml:本项目 PRD 文档目录清单 */
export interface PrdModuleYaml {
  dir?: string;                                        // PRD 根(原型 extraBase)
  folders: { name: string; dir: string }[];
}

/** git.yaml:本项目 git 仓库(id 用稳定 slug) */
export interface GitModuleYaml {
  repos: { id: string; name: string; path: string; notes?: string }[];
}

/** commands.yaml:本项目「自定义命令」(命令抽屉按钮;type 固定 custom,系统预设为面板常量不入文件) */
export interface CommandsModuleYaml {
  commands: { id: string; label: string; command: string; cwd?: string; subgroup?: string }[];
}

export type ModuleYaml = LogsModuleYaml | SqlModuleYaml | PrdModuleYaml | GitModuleYaml | CommandsModuleYaml;

const EMPTY: Record<string, ModuleYaml> = {
  logs: { sections: [] },
  sql: { connections: [] },
  prd: { dir: '', folders: [] },
  git: { repos: [] },
  commands: { commands: [] },
};

/** 每个模块默认 YAML 模板(注释即说明书,AI/人照着加即可;面板实时读取) */
const DEFAULT_TEXT: Record<string, string> = {
  logs: `# ── logs.yaml —— 本项目「日志清单」(面板 /log 实时 tail 的文件) ──────────────
# ⚠️ 路径一律写「相对项目根」的相对路径(如 code/backend/.../a.log),
#    面板读取时自动补成绝对路径;换机器/换目录本文件可随仓库直接用。
#
# 结构:
#   sections:              列表,按分组展示(如「后端」「前端」),可多组
#     - name: 分组名
#       logs:
#         - name: 显示名        (必填,面板左侧列表显示)
#           file: 相对项目根    (必填,日志文件路径;不存在会显示 ○)
#           port: 服务端口      (可选,填了做端口存活检测,亮●/灭○)
#
# 示例(去掉 # 即生效):
#   sections:
#     - name: 后端
#       logs:
#         - { name: main-api, file: code/backend/apps/main/logs/api.log, port: 8080 }
#     - name: 前端
#       logs:
#         - { name: web, file: code/frontend/web.log }
sections: []
`,
  sql: `# ── sql.yaml —— 本项目「数据库连接」(面板 /sql 查询/审批用) ────────────────
# 修改即生效。面板执行 SQL 时按本项目连接操作;写操作受全局 ReviewMode 管控。
# ⚠️ sqlite 的 path 也写「相对项目根」的相对路径,面板自动补绝对;mysql 填 host/端口等。
#
# 字段:
#   id        连接唯一标识(字符串,引用/历史记录用它)
#   name      显示名
#   type      mysql | sqlite
#   mysql:    host / port / user / password / database
#   sqlite:   path(库文件,相对项目根,如 code/data/app.db)
#   notes     备注(可选)
#
# 示例:
#   connections:
#     - { id: main-db, name: 主库, type: mysql, host: 127.0.0.1,
#         port: 3306, user: root, password: "xxxx", database: app, notes: 开发库 }
#     - { id: local-sqlite, name: 本地库, type: sqlite, path: code/data/app.db }
connections: []
`,
  prd: `# ── prd.yaml —— 本项目「PRD 文档目录」(面板 /prd 浏览/渲染) ─────────────────
# ⚠️ dir/folders 一律写「相对项目根」的相对路径(如 PRD/owner),面板自动补绝对。
# dir:     PRD 根目录(相对项目根,可空;如 PRD)
# folders: 面板左侧目录清单,每项一个 { name, dir(相对项目根) }
#
# 示例:
#   dir: PRD
#   folders:
#     - { name: 需求中心, dir: PRD/owner }
#     - { name: 原型稿,   dir: PRD/proto }
dir: ""
folders: []
`,
  git: `# ── git.yaml —— 本项目「git 仓库」(面板 /git 变更/diff/历史/文件浏览) ─────
# ⚠️ path 写「相对项目根」的相对路径;'.' = 项目根本身(即本项目仓库)。
#    面板读取时自动补成绝对。
# id 是面板路由引用键(如 /api/git/diff/<id>):只有一个仓库时写项目名即可,多仓库各取不同短名。
#
# 示例:
#   repos:
#     - { id: myproj, name: myproj, path: ., notes: 本项目仓库 }
repos: []
`,
  commands: `# ── commands.yaml —— 本项目「自定义命令」按钮(左下角命令抽屉)─────────────
# 每条 = 一个可点按钮,点它在终端跑一条命令(可对当前项目做启动/停止/重启等)。
# 注意:系统预设(磁盘/内存/CPU…)是面板内置的,不用写在这里;这里只放项目自己的命令。
# ⚠️ cwd 写「相对项目根」的相对路径(如 '.' / code);面板自动补绝对。
#
# 字段:
#   id         唯一标识(面板里添加会自动生成、不用手填;只有手写本文件时才给一个不重复值,如 c1、c2。编辑/删除用它定位)
#   label      按钮文字(如 "🚀 全部启动")
#   command    要执行的命令(用相对项目根的脚本最稳,如 bash start.sh start all)
#   cwd        可选,命令执行的工作目录(相对项目根)
#   subgroup   可选,抽屉里的分组名(如 "快速启动"/"停止"),同名的聚成一块
#
# 典型示例(把下面去掉注释、改成你的启动脚本即可):
#   commands:
#     - { id: c1, label: "🚀 全部启动", command: "bash start.sh start all", subgroup: "快速启动", cwd: . }
#     - { id: c2, label: "🛑 全部停止", command: "bash start.sh stop all", subgroup: "快速启动", cwd: . }
#     - { id: c3, label: "🚀 启动后端", command: "bash start.sh start main", subgroup: "单模块", cwd: . }
commands: []
`,
};

export type ModuleName = 'logs' | 'sql' | 'prd' | 'git' | 'commands';

/** 读模块 YAML(缺失/损坏→默认空结构) */
export function loadModuleYaml<T extends ModuleYaml>(file: string, module: ModuleName): T {
  try {
    if (!fs.existsSync(file)) return structuredClone(EMPTY[module]) as T;
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    if (doc && typeof doc === 'object') return doc as T;
    return structuredClone(EMPTY[module]) as T;
  } catch (e) {
    console.warn(`[yaml] 读取失败回退默认(${file}):`, (e as Error).message);
    return structuredClone(EMPTY[module]) as T;
  }
}

/** 写模块 YAML(全量重写;注释会丢失属预期) */
export function writeModuleYaml(file: string, value: unknown): void {
  const dir = file.substring(0, file.lastIndexOf('/'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const text = yaml.dump(value, { noRefs: true });
  fs.writeFileSync(file, text.startsWith('\n') ? text.slice(1) : text, 'utf8');
}

/** 确保存在默认 YAML(缺失才写,带注释版本) */
export function ensureDefaultYaml(file: string, module: ModuleName): boolean {
  if (fs.existsSync(file)) return false;
  const dir = file.substring(0, file.lastIndexOf('/'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, DEFAULT_TEXT[module], 'utf8');
  return true;
}
