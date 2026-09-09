// ── 项目模块 YAML 的读写与类型(logs/sql/prd/git 一模块一文件) ──
//   文件缺失/解析失败一律回退默认空结构,绝不抛错打死接口。

import fs from 'fs';
import yaml from 'js-yaml';
import type { DbConnection } from '../types';

// ── 类型 ────────────────────────────────────────────────

/** 单个应用服务(平台里后端/前端的一项);start/stop 为可执行脚本,面板开终端执行 */
export interface AppServiceYaml {
  name: string;
  file: string;
  port?: number;
  start?: string;
  stop?: string;
}

/** apps.yaml(旧名 logs.yaml):按「平台」分组,每个平台含自身 后端/前端(向后兼容旧 sections 平铺) */
export interface LogsModuleYaml {
  platforms?: {
    name: string;
    backend?: AppServiceYaml[];
    frontend?: AppServiceYaml[];
  }[];
  sections?: { name: string; logs: AppServiceYaml[] }[];
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

/** links.yaml:本项目「快捷方式/Quick Links」(/log 顶栏 🔗 下拉;纯展示,提交式随仓库走) */
export interface LinksModuleYaml {
  groups?: {
    name: string;
    items: { name: string; urls: { label?: string; url: string }[] }[];
  }[];
}

/** redis.yaml:本项目「Redis 连接」(/redis 查看/清缓存;host 支持 ${VAR:default} 插值) */
export interface RedisModuleYaml {
  connections: import('../types').RedisConnection[];
}

export type ModuleYaml =
  | LogsModuleYaml | SqlModuleYaml | PrdModuleYaml | GitModuleYaml
  | CommandsModuleYaml | LinksModuleYaml | RedisModuleYaml;

const EMPTY: Record<string, ModuleYaml> = {
  logs: { platforms: [] },
  sql: { connections: [] },
  prd: { dir: '', folders: [] },
  git: { repos: [] },
  commands: { commands: [] },
  links: { groups: [] },
  redis: { connections: [] },
};

/** 每个模块默认 YAML 模板(注释即说明书,AI/人照着加即可;面板实时读取) */
const DEFAULT_TEXT: Record<string, string> = {
  logs: `# ── apps.yaml(旧名 logs.yaml)—— 本项目「应用服务」:实时日志 + 一键 启动/停止 ──
# 按「平台」分组:每个平台一个块,组内含它自己的 后端 / 前端 应用(可只写其一)。
# ⚠️ file 写「相对项目根」的相对路径(如 .logs/a.log),面板自动补绝对;start/stop 同理
#    写相对脚本(如 .claude/skills/.../start.sh),面板以项目根为工作目录执行。
#
# 结构:
#   platforms:                   平台列表(面板每平台一张卡片)
#     - name: 平台名             (如 交易总部)
#       backend:  [该平台后端应用]  每项字段:
#         name   应用名(如 main)
#         file   日志文件(相对项目根)
#         port   服务端口(端口存活 → 面板判断 启动/停止)
#         start  启动脚本(相对项目根;如 bash .claude/skills/fast-start/start.sh start main)
#         stop   停止脚本(同上,stop main)
#       frontend: [该平台前端应用](同上;名通常带 -vue)
#
# 示例(去掉 # 即生效):
#   platforms:
#     - name: 交易总部
#       backend:  [ { name: trade-hall, file: .logs/trade-hall.log, port: 7148,
#                      start: "bash .claude/skills/fast-start/start.sh start trade-hall",
#                      stop:  "bash .claude/skills/fast-start/start.sh stop trade-hall" } ]
#       frontend: [ { name: trade-hall-vue, file: .logs/trade-hall-front.log, port: 7149,
#                      start: "bash .claude/skills/fast-start/start.sh start trade-hall-vue",
#                      stop:  "bash .claude/skills/fast-start/start.sh stop trade-hall-vue" } ]
#     - name: 门户
#       frontend: [ { name: website-vue, file: .logs/website.log, port: 7165 } ]
platforms: []
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
  links: `# ── links.yaml —— 本项目「快捷方式/Quick Links」(/log 顶栏 🔗 下拉) ──────
# 提交式、随仓库走,想改就编辑本文件,面板只负责「展示 + 打开」。修改即生效。
# 按「分组」存放常用地址;每个链接可带 1..N 个访问地址(如 内网/域名/测试 多环境)。
#
# 字段:
#   groups:          分组列表,每项:
#     name           组名(如 认证 / 资源)
#     items:         组内快捷链接,每项:
#       name         链接名(如 认证登录 / OSS 控制台)
#       urls:        该链接可访问的地址列表(1..N),每项:
#         label      可选,环境/入口标识(如 内网 / 域名);不写则面板直接显示 url
#         url        访问地址:可完整 URL(带 http:// 或 https://),
#                    也可只写「裸域名/主机 + 路径」(如 dev.example.com/auth/login),
#                    面板打开时自动补 http:// 前缀
#
# 示例(去掉 # 即生效):
#   groups:
#     - name: 认证
#       items:
#         - name: 认证登录
#           urls:
#             - { label: 内网, url: "http://127.0.0.1:7129/auth/login" }
#             - { label: 域名, url: "dev.example.com/auth/login" }
#         - name: HQ 登录
#           urls:
#             - { label: 域名, url: "http://dev.example.com/hq/login" }
#     - name: 资源
#       items:
#         - { name: OSS 控制台, urls: [ { url: "http://dev.example.com/resource" } ] }
groups: []
`,
  redis: `# ── redis.yaml —— 本项目「Redis 连接」(面板 /redis 查看缓存/清缓存) ──────────
# 修改即生效。host/port/password 支持 \${VAR:默认值} 环境变量占位符(跨机器切换)。
# 字段:
#   id        连接唯一标识(如 hq / school,与 sql.yaml 平台 id 对齐)
#   name      显示名
#   host/port/password  连接参数(port 默认 6379)
#   db        默认聚焦的 db 号(可选;方舟按实例分 db 50-58)
#   notes     备注(可选)
#
# 示例(去掉注释即生效):
#   connections:
#     - { id: hq, name: 总部缓存(db50), host: "\${CODE_PANEL_REDIS_HOST:127.0.0.1}",
#         port: 6379, password: "your-redis-password", db: 50, notes: 平台 hq }
connections: []
`,
};

export type ModuleName = 'logs' | 'sql' | 'prd' | 'git' | 'commands' | 'links' | 'redis';

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
