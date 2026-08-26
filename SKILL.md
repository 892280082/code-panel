---
name: code-panel
description: >-
  运维控制面板：实时日志追踪、SQL 查询/审批、Git 仓库管理（变更 diff/提交历史/文件浏览）、
  持久化终端（命令抽屉 + tmux/ttyd 接入）、系统资源监控、自动备份、PRD 文档面板（MD→HTML + 原型 iframe 嵌入）。
  用户说"查看日志、看日志、追踪日志、tail 日志、查数据库、执行 SQL、数据库查询、配置数据库、
  添加日志文件、看 git、git diff、浏览仓库代码、仓库文件、开终端、tmux 会话、系统资源、CPU 内存、备份、
  PRD、写PRD、设计原型、打开PRD、PRD面板"时触发。
  启动端口 3008。前端 Vue 3 + Pinia + Vue Router。
---

## 启动

```bash
bash ~/.claude/skills/code-panel/start.sh
```

## 访问面板

| 路径 | 用途 |
|------|------|
| `http://localhost:3008/log` | 日志查看器（实时追踪 + 分组管理 + 系统资源圆环 + 备份按钮） |
| `http://localhost:3008/sql` | SQL 评审面板（审批/拒绝 + DB 存活状态 + 查询历史） |
| `http://localhost:3008/git` | Git 仓库管理（变更 diff / 提交历史 / 仓库文件浏览器） |
| `http://localhost:3008/prd` | **PRD 文档面板**（左侧文件夹 + MD 文件，点开内嵌渲染 + 原型 iframe，目录完成状态） |

---

## PRD 指令（用户说"PRD"时执行）

> **触发词**：PRD、写PRD、设计原型、打开PRD、PRD面板。用户说这些时，按下面的强制流程写 PRD 文档并渲染。

### 强制原型结构规范（写 PRD 必须按此顺序，禁止跳过）

```
① 设计数据库表结构
   → 表 / 字段（类型·长度·可空）/ 主外键 / 索引 / 枚举值
   → 产出：数据模型表（markdown 表格）
② 表设计
   → 表之间的关系 / 用途说明 / 数据来源
   → 产出：表设计说明
③ 业务逻辑
   → 流程 / 状态流转 / 分支 / 接口
   → 产出：文字步骤（第一 / 第二 / 第三 …，不用 mermaid——面板渲染易失败）
④ 编写原生 HTML 页面（原型）
   → 按①②③的设计画手机/桌面线框
   → 产出：PRD/<端>/xxx-原型.html
   → MD 文档中引用该 HTML 路径
```

> ⚠️ 数据库结构没定，不画页面；业务逻辑没理清，不做菜单。

### 文档组织规范（伪代码目录模式 · ⭐2026-08-24 用户拍板 · 强制）

**伪代码 = 一个目录**（`伪代码/`），不再是单个大 .md 文件：

```
伪代码/
├── index.md                      ← 入口:步骤导航 + 核心差异 + 全链流程图
├── 步骤1-<名称>.md               ← 每步骤一个 md 文件
├── 步骤2-<名称>.md
├── ...
├── 步骤1-<端>-<功能>.js          ← 代码文件(每页/每功能一个,供 @tabs 切换)
├── ...
```

**每个步骤 md 文件内部固定四件套**（严格按此顺序，禁止打乱）：

```
# 步骤N · <名称>
## 1 介绍       → 步骤说明 + 原型图(`> 原型图：\`PRD/端名/xxx.html\`` 链接形式,面板自动内联 iframe)
## 2 表结构     → 涉及表/字段/列集(markdown 表格;数据库结构没定,不画页面)
## 3 流程       → 文字步骤(第一/第二/第三 …,不用 mermaid——面板渲染易失败)
## 4 伪代码 Tab → `> @tabs 步骤N`
```

**前端多页面(多原型)按页面组织**，每页面 = 原型图 + 页面介绍 + 伪代码，禁止"一大堆原型 → 一大堆介绍 → 一大堆代码"分开堆：

```
## 页面1 · <名称>
> 原型图：\`PRD/端名/xxx.html\`
**页面介绍**:...
**伪代码**:
> @tabs 步骤5
```

**代码文件规则**（`伪代码/` 目录下，与步骤 md 同目录）：
- 命名 `步骤N-<端>-<功能>.<ext>`(js/java/ts/sql…)，**一个步骤可拆多个 Tab(分得越细越好)**，每页/每功能一个文件
- 内容要详细:文件头注释(步骤·端·作用)+ 完整函数 + 分步注释 ①②③ + 接口路径/入参/出参 + 错误码
- Tab 按钮自动取文件名(去 `步骤N-` 前缀 + 扩展名,横杠转「 · 」);`@tabs` 支持多前缀合并到同一组件一行切换:`> @tabs 步骤3,步骤8`
- 步骤 md 内部用 `> @tabs 步骤N` 引用;前端/后端并列文件 = 前端·后端两个 Tab(如 `步骤1-前端-导入模板与上传.js` + `步骤1-后端-导入容器与列集换算.js`)

**md-render 渲染能力**(code-server):左栏文档导航(当前文件高亮)、章节白卡、语法高亮、⛶ 全屏(左侧 Tab 栏点击切换,ESC/✕ 退出)、原型 iframe 内联。

### 渲染（MD → HTML + 原型 iframe）

- MD 文档里用 `> 原型图：\`PRD/xxx/yyy.html\`` 在**每个步骤下方**引用原型路径
- code-panel PRD 面板（`/prd`）点开文档 → 渲染 MD + **自动把原型 iframe 内联到引用处**（每步下方即见该步原型，不堆文档末尾、不显示文本路径）
- 用户即可一边看 MD 方案、一边看对应原型

### 目录完成状态

- 完成状态**针对整个目录**（左侧文件夹），沉淀到数据库（`prd_status` 表）
- 选中目录 → 右上角「✓ 已完成 / 未完成」按钮切换
- 重启不丢失

---

## API 清单

### 数据库连接管理

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/db` | — | `[{id, name, type, version, group?, host?, port?, user?, database?, path?, notes?, hasPassword, alive, lastCheck, serverVersion, healthError}]` |
| **POST** | `/api/db` | `{id, name, type, version, group?, host?, port?, user?, password?, database?, path?, notes?}` | `{ok:true}` |
| **PUT** | `/api/db/:id` | 部分字段（含 group） | `{ok:true}` |
| **DELETE** | `/api/db/:id` | — | `{ok:true}` |
| **POST** | `/api/db/test` | `{type, host?, port?, user?, password?, database?, path?}` | `{ok:bool, serverVersion?, error?}` |
| **POST** | `/api/db/refresh` | — | `{ok:true, elapsed, databases:[{id,name,alive,serverVersion,healthError,lastCheck}]}` |

### SQL 执行

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **POST** | `/api/sql/query` | `{sql, title, dbId, connection?}` | `{ok:true, rows, executionTime}` |
| **POST** | `/api/sql/submit` | `{sql, reason, title, dbId, connection?}` | `{ok:true, id, status, mode}` — status=`"pending"`(待审批) 或 `"executed"`(静默模式已执行) |
| **GET** | `/api/sql/status/:id` | — | `{id, status, sql, reason, dbId, submittedAt, reviewedAt?, rejectReason?, result?, error?}` |
| **GET** | `/api/sql/history` | — | `{ok:true, list:[{id, title, sql, dbId, dbLabel, result, executedAt}]}` |
| **GET** | `/api/sql/review-mode` | — | `{reviewMode:bool, token}` |
| **POST** | `/api/sql/review-mode` | `{enabled:bool, token}` | `{ok:true, reviewMode:bool}` |

> `connection` 字段支持**直连模式**: `{type, host?, port?, user?, password?, database?, path?}`，优先级高于 `dbId`。
> `title` 字段是**必填**的 — 每次操作都必须说明"为什么查/改这次数据库"。

### SQL 评审（审批面板）

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/sql/queue` | `?status=pending`（可选） | `{ok:true, jobs, reviewMode}` |
| **POST** | `/api/sql/approve/:id` | `{token}` | `{ok:true, id, status:"executed", result}` |
| **POST** | `/api/sql/reject/:id` | `{reason?, token}` | `{ok:true, id, status:"rejected"}` |

> `/approve` 和 `/reject` 需要 `token` 验证（每次重启服务生成新 token），前端页面会自动获取。

### 日志分组配置

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/log-config` | — | `[{key, name, logs:[{id, name, file}]}]` |
| **POST** | `/api/log-config` | `{key, name, logs?:[{name,file}]}` | `{ok:true}` |
| **PUT** | `/api/log-config/:key` | `{name}` | `{ok:true}` |
| **DELETE** | `/api/log-config/:key` | — | `{ok:true}`（级联删除所有条目） |
| **POST** | `/api/log-config/:key/logs` | `{name, file, port?}` | `{ok:true, id}` |
| **PUT** | `/api/log-config/:key/logs/:id` | `{name?, file?, port?}` | `{ok:true}` |
| **DELETE** | `/api/log-config/:key/logs/:id` | — | `{ok:true}` |

### 日志查看

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/logs` | — | `[{name, file, groupKey, groupName, exists, size, active, port?, alive}]`（按活跃度排序） |
| **GET** | `/api/log/content` | `?file=<path>` | `{content, size}` |
| **POST** | `/api/log/clear` | `{file}` | `{ok:true}` — 清空日志文件（类似 `: > file`） |
| **GET** | `/api/stream` | — | SSE 流，实时推送日志变更 |

### 终端命令抽屉 API

管理右上角绿色 FAB 按钮 → 右侧抽屉里的预填写命令。支持**增删改 + 排序 + 日志分组联动 + 子分组**。

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/terminal/commands` | `?group=xxx`（可选筛选） | `{ok:true, data:[...]}` |
| **POST** | `/api/terminal/commands` | `{label, command, cwd?, group?, subgroup?}` | `{ok:true, data:{id,label,command,cwd?,group?,subgroup?,type:"custom",...}}` |
| **PUT** | `/api/terminal/commands/reorder` | `{ids:[], group?}` | `{ok:true}` |
| **PUT** | `/api/terminal/commands/:id` | `{label?, command?, cwd?, group?, subgroup?}` | `{ok:true, data:{...}}` |
| **DELETE** | `/api/terminal/commands/:id` | — | `{ok:true}` |

**字段说明**：
| 字段 | 类型 | 必填 | 限制 |
|------|------|------|------|
| `label` | string | ✅ | 1-100 字符，按钮显示名称 |
| `command` | string | ✅ | 1-4096 字符，终端中执行的命令 |
| `cwd` | string | 否 | 绝对路径（`/` 开头），命令执行的工作目录 |
| `group` | string | 否 | 所属**日志分组 key**（与侧栏日志分组联动，`?group=xxx` 过滤），为空时全局可见 |
| `subgroup` | string | 否 | **子分组名**（同一日志分组内再分块展示，如「快速启动」「单平台(前后台一体)」），为空时归入「未分组」块 |

> **分组联动**：当指定 `?group=xxx` 查询时，只返回该分组的自定义命令。系统预设命令（磁盘空间、内存、CPU 等 7 条）全局可见。前端自动跟随当前日志分组切换。
> **子分组**：抽屉内自定义命令按 `subgroup` 聚合成区块展示（区块头 + 命令数），新建/编辑表单可填子分组（datalist 自动提示已有分组）。排序为**组内**排序（不跨子分组）。

**示例**：
```bash
# 注册一条自定义命令（关联到 production 日志分组 + 快速启动子分组）
curl -s -X POST http://localhost:3008/api/terminal/commands \
  -H 'Content-Type: application/json' \
  -d '{"label":"🚀 全部启动","command":"bash /path/to/start.sh start all","group":"production","subgroup":"快速启动"}'

# 按日志分组查看命令
curl -s "http://localhost:3008/api/terminal/commands?group=production"

# 编辑命令（改子分组）
curl -s -X PUT http://localhost:3008/api/terminal/commands/<id> \
  -H 'Content-Type: application/json' \
  -d '{"label":"改后名称","command":"echo hello","subgroup":"单平台"}'

# 排序（传入自定义命令 ID 数组的新顺序）
curl -s -X PUT http://localhost:3008/api/terminal/commands/reorder \
  -H 'Content-Type: application/json' \
  -d '{"ids":["id1","id2","id3"],"group":"production"}'

# 删除命令
curl -s -X DELETE http://localhost:3008/api/terminal/commands/<id>
```

> `type: "system"` 的命令（磁盘空间、内存、CPU、网络连接、进程列表、系统负载、磁盘 IO）为只读预设，不可编辑删除。API 创建的命令固定为 `type: "custom"`。

#### ⭐ 终端自定义命令默认模式（前后端一体 + 子分组，⭐2026-08-26 用户定稿 · 强制）

**以后添加任何项目的终端自定义命令，默认按这个模式组织**（参考 code-server 的 demo 分组）：

**① 命令本身做"前后端一体"** — 一个命令同时起/停该项目的前端 + 后端，不要只起前端：

```
# 单平台：start <平台> <平台>-vue（前后端一起）
bash <项目>/.claude/skills/<start脚本> start main main-vue
# 全部：start all
bash <项目>/.claude/skills/<start脚本> start all
```

- demo 项目用 `my-start`：`bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh start main main-vue`
- 其余项目参考其 `fast-start` / `my-start` 的 `start.sh`（命名规则统一：不带 `-vue` = 后端，带 `-vue` = 前端，`all` = 全部前后端）

**② 同一 `group`（日志分组）内，用 `subgroup` 分三个固定子分组**，顺序如下：

| subgroup | 内容 | 命令形态 |
|----------|------|---------|
| **快速启动** | 全部启动 / 全部关闭 / 安装公共包（3 条） | `start all` / `stop all` / `clean install` |
| **单平台(前后台一体)** | 各平台启动（每平台 1 条） | `start <平台> <平台>-vue` |
| **停止(前后台一体)** | 各平台关闭（每平台 1 条） | `stop <平台> <平台>-vue` |

**③ 录入顺序**：先在 JSON/API 里写「快速启动」3 条 → 再各平台「启动」「停止」成对写入（保证前端聚合后子分组顺序正确）。

**示例**（demo 组已按此配置，见 `data/terminal-commands.json`）：
```json
[
  { "label": "🚀 全部启动(前后端一体)", "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh start all", "group": "demo", "subgroup": "快速启动" },
  { "label": "🛑 全部关闭",             "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh stop all",  "group": "demo", "subgroup": "快速启动" },
  { "label": "🧹 安装公共包(清空重装)", "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh clean install", "group": "demo", "subgroup": "快速启动" },
  { "label": "🚀 启动 main-platform(前后端一体)", "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh start main main-vue", "group": "demo", "subgroup": "单平台(前后台一体)" },
  { "label": "🛑 关闭 main-platform",   "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh stop main main-vue",  "group": "demo", "subgroup": "停止(前后台一体)" }
]
```

### Tmux 持久化终端 API

管理**持久化终端**：tmux session 常驻服务器，ttyd 只是接入通道（断开/刷新后 session 不丢，可随时重连）。

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/terminal/tmux/list` | — | `{ok:true, data:[{name, description?, created?}]}`（tmux 未安装/无会话时返回空列表） |
| **POST** | `/api/terminal/tmux/create` | `{name, description?}` | `201 {ok:true, data:{name}}` |
| **POST** | `/api/terminal/tmux/attach` | `{name}` | `201 {ok:true, data:{port, sessionName}}` — 为该 session 启动 ttyd，返回端口 |
| **DELETE** | `/api/terminal/tmux-sessions/:port` | — | `{ok:true}` — 断开 ttyd 接入，**不杀** tmux session |
| **DELETE** | `/api/terminal/tmux/:name` | — | `{ok:true}` — 彻底删除（断开 + kill session） |

> 前端 iframe 统一用 `/api/terminal/<port>/?token=<JWT>` 连接（与其他 ttyd 终端一致）。
> 使用流程：`create`（常驻会话）→ `attach`（拿端口）→ iframe 接入；用完 `tmux-sessions/:port` 断开或 `tmux/:name` 删除。
> 页面级终端（一次性，非持久化）：`POST /api/terminal/sessions`（`{label, command, cwd}`）→ 返回 `{port}`，`DELETE /api/terminal/sessions/:port` 关闭。

### Git 仓库管理 API

管理注册的 git 仓库（路径 + 备注），提供**变更 diff、提交历史、源码查看、一键 pull**。仓库列表存储在 `data/git-repos.json`。

| 方法 | 路径 | 请求体/参数 | 响应 |
|------|------|-------------|------|
| **GET** | `/api/git/repos` | `?group=`（可选标签筛选） | `[{id, name, path, notes, group?, createdAt, updatedAt}]` |
| **POST** | `/api/git/repos` | `{name, repoPath, notes?, group?}` | `{ok:true, repo:{...}}` |
| **PUT** | `/api/git/repos/:id` | 部分字段 | `{ok:true}` |
| **DELETE** | `/api/git/repos/:id` | — | `{ok:true}` |
| **GET** | `/api/git/summary/:id` | `?staged=` | `{repoId, repoName, branch, clean, fileCount, additions, deletions}` |
| **GET** | `/api/git/diff/:id` | `?staged=` | `{ok:true, repoId, repoName, repoPath, branch, stat, files:[{path, status: added/deleted/modified/renamed, additions, deletions, hunks:[{header, lines:[{type: context/addition/deletion, content, oldLine?, newLine?}]}]}]}` |
| **GET** | `/api/git/source/:id` | `?file=<repo内相对路径>` | `{ok:true, path, size, content}`（路径穿越防护） |
| **GET** | `/api/git/log/:id` | `?limit=100&offset=0` | `{ok:true, repoId, repoName, branch, totalCommits, dayGroups:[{date, commits:[{hash, author, email, date, subject, body}]}]}` |
| **POST** | `/api/git/pull-all` | `?group=`（可选） | `{ok:true, results:[{repoId, repoName, branch, status: pulled/up-to-date/conflict/error/no-remote, message, pulledCount?}]}` |

**示例**：注册仓库 + 看变更
```bash
# 注册一个仓库（path 必须是服务器上真实 git 仓库的绝对路径）
curl -s -X POST http://localhost:3008/api/git/repos \
  -H 'Content-Type: application/json' \
  -d '{"name":"code-panel","repoPath":"/Users/owner/.claude/skills/code-panel","notes":"运维面板","group":"ops"}'

# 看仓库状态（分支/是否干净/变更文件数）
curl -s http://localhost:3008/api/git/summary/1

# 看完整 diff（含 hunks）
curl -s http://localhost:3008/api/git/diff/1

# 看某文件源码
curl -s "http://localhost:3008/api/git/source/1?file=src/server.ts"

# 一键 pull 所有仓库
curl -s -X POST http://localhost:3008/api/git/pull-all
```

### Repo Browser（仓库文件浏览器）API

前端弹窗（📂 按钮）内的文件树 + 预览 + 历史，也可以直接调 API 浏览任意注册仓库。

| 方法 | 路径 | 参数 | 响应 |
|------|------|------|------|
| **GET** | `/api/repo-browser/:repoId/git-changes` | — | `{ok:true, changedDirs:[], changedFiles:[]}`（staged+unstaged+untracked 变更，含父目录层级） |
| **GET** | `/api/repo-browser/:repoId/tree` | `?path=`（子目录，空=根） | `{ok:true, repoId, repoName, path, entries:[{name, type: file/dir, size}]}`（目录优先排序） |
| **GET** | `/api/repo-browser/:repoId/file` | `?path=&offset=&limit=` | `{ok:true, path, content, lang, offset, limit, totalSize, hasMore, binary}`（分段读取，上限 10MB，二进制文件 `binary:true`） |
| **GET** | `/api/repo-browser/:repoId/diff` | `?path=` | `{ok:true, path, lines:[{type: add/del/ctx, text}], rawDiff}` |
| **GET** | `/api/repo-browser/:repoId/file-log` | `?path=&limit=50` | `{ok:true, path, totalCommits, dayGroups:[{date, commits:[...]}]}` |
| **GET** | `/api/repo-browser/:repoId/file-commit-diff` | `?path=&commit=` | `{ok:true, ...diff}`（某次提交对该文件的变更） |
| **GET** | `/api/repo-browser/:repoId/commit-files` | `?commit=` | `{ok:true, ...files}`（某次提交涉及的文件列表） |

> 所有 `path` 参数走 `safeResolve` 防路径穿越；文件 >10MB 拒绝读取。

### 系统资源监控 API

| 方法 | 路径 | 响应 |
|------|------|------|
| **GET** | `/api/resources` | `{cpu:{percent, cores, load1, load5}, memory:{percent, usedGB, totalGB}, disk:{percent, usedGB, totalGB, mount}}` |
| **GET** | `/api/resources/processes` | `{processes:[{pid, name, memPercent, rssMB, cpuPercent}]}`（内存 TOP 30） |

> 前端 `/log` 工具栏的两个圆环（CPU/内存），点击弹出详情（折线图 + 进程表）。

### 备份管理 API

每天自动备份一次（`backups/backup-<日期>.tar.gz`），保留最近 10 天；可手动触发 + 下载。

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/backup` | — | `{ok:true, data:[{filename, date, size, createdAt}]}`（按日期倒序） |
| **POST** | `/api/backup` | — | `201 {ok:true, data:{filename, date, size, createdAt}}` — 立即备份 |
| **GET** | `/api/backup/:filename` | — | 下载 tar.gz（`?token=<JWT>` 或 Authorization 头） |

> 前端入口在 `/log` 工具栏"备份"按钮（资源显示器左边）。

### PRD 文档 API

| 方法 | 路径 | 说明 |
|------|------|------|
| **GET** | `/prd` | PRD 面板页（左侧文件夹 → MD 文件 → 内嵌预览） |
| **GET** | `/api/prd/folders` | 文件夹列表（名称/目录/文件数/日期/完成状态） |
| **GET** | `/api/prd/files?dir=` | 某目录下 MD 文件列表 |
| **GET** | `/api/prd/content?dir=&file=` | 内嵌预览（渲染 MD + 原型 iframe，无左侧导航） |
| **GET** | `/api/prd/view?dir=&file=` | 双栏查看页（左 MD 列表 + 右渲染 HTML） |
| **GET** | `/api/prd/file?p=` | 读取原型 HTML（供 iframe） |
| **POST** | `/api/prd/done` | `{dir, done}` 切换**目录**完成状态（沉淀数据库） |

> 完成状态针对**整个目录**，存 SQLite `prd_status` 表；配置在 `config.json` 的 `prd.folders`（名称 + 目录）。

### 全局配置

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/config` | — | `{groups, databases, reviewMode}` |
| **PUT** | `/api/config` | 完整 config 对象 | `{ok:true}` |

---

## 📝 数据录入教程（教别人如何录入数据）

面板自己的配置（数据库连接、日志分组、终端命令）都存储在 `data/db-config.sqlite` + `data/terminal-commands.json`。
录入数据有两条路：**① 调 API（推荐，可批量、可被 AI 执行）** ② **前端页面点加号**（人工操作）。下面是 API 方式。

### 当前库里的数据（截至 2026-08-04，可直接模仿）

**数据库连接（3 条，`connections` 表）**

| id | name | type | group | host | port | user | database | path |
|----|------|------|-------|------|------|------|----------|------|
| `zc-main` | zc-main | mysql | proj | db.example.com | 3306 | root | integration_platform | — |
| `zc-exam` | zc-exam | mysql | proj | db.example.com | 3306 | root | integration_exam | — |
| `opencode-platform` | opencode-platform | sqlite | proj | — | — | — | — | /Users/owner/repository/proj-v3/zc-opencode/opencode-platform.db |

**日志分组（2 个）+ 日志条目（9 条）**

| 分组 key | 分组名 | 日志条目（name → file，port） |
|----------|--------|------------------------------|
| `proj` | proj | zc-main → /tmp/zc-main.log (7071)、zc-platform-backend → /tmp/zc-platform-backend.log (6173)、zc-study → /tmp/zc-study.log (6170)、zc-exam → /tmp/zc-exam.log (7072)、ai-opencode-server → /tmp/ai-opencode-server.log (3011)、ai-platform-api → /tmp/ai-platform-api.log (3015)、ai-platform → /tmp/ai-platform.log (3013)、ai-chat → /tmp/ai-chat.log (3014) |
| `test` | 测试 | 测试日志 → /tmp/test-log.log |

**终端命令**：7 条系统预设（`type: system`，只读）+ 自定义命令（`type: custom`），如 `🚀 启动主模块`（group: proj，执行 fast-start 脚本）。

### ① 录入数据库连接

```bash
# MySQL 连接（模仿 zc-main）
curl -s -X POST http://localhost:3008/api/db \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-db",                          # 唯一标识（必填）
    "name": "my-db",                        # 显示名称（必填）
    "type": "mysql",                        # mysql | sqlite（必填）
    "version": "8.0",
    "group": "proj",                        # 所属分组，可空
    "host": "db.example.com",
    "port": 3306,
    "user": "root",
    "password": "xxxx",
    "database": "integration_platform",
    "notes": "备注说明"
  }'

# SQLite 连接（模仿 opencode-platform，无 host/port/user，用 path）
curl -s -X POST http://localhost:3008/api/db \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-sqlite",
    "name": "my-sqlite",
    "type": "sqlite",
    "group": "proj",
    "path": "/absolute/path/to/xxx.db"      # 必须是绝对路径
  }'

# 验证连接是否可用（不用先录入，直接测）
curl -s -X POST http://localhost:3008/api/db/test \
  -H 'Content-Type: application/json' \
  -d '{"type":"mysql","host":"db.example.com","port":3306,"user":"root","password":"xxxx","database":"integration_platform"}'
# → {ok:true, serverVersion:"8.0.36"} 或 {ok:false, error:"..."}
```

### ② 录入日志分组 + 日志条目

```bash
# 一次性创建分组并带日志条目（模仿 test 分组）
curl -s -X POST http://localhost:3008/api/log-config \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "my-group",                      # 分组唯一 key（必填）
    "name": "我的分组",                      # 显示名称（必填）
    "logs": [
      {"name": "日志A", "file": "/tmp/log-a.log"},
      {"name": "日志B", "file": "/tmp/log-b.log"}
    ]
  }'

# 分组已存在时，往分组里加一条日志（模仿 proj 组的 8 条）
curl -s -X POST http://localhost:3008/api/log-config/proj/logs \
  -H 'Content-Type: application/json' \
  -d '{"name": "zc-main", "file": "/tmp/zc-main.log", "port": 7071}'
# → {ok:true, id:9}   # port 用于端口存活检测，不需要就不传

# 改日志条目 / 删日志条目
curl -s -X PUT http://localhost:3008/api/log-config/proj/logs/9 \
  -H 'Content-Type: application/json' -d '{"file": "/tmp/zc-main-new.log"}'
curl -s -X DELETE http://localhost:3008/api/log-config/proj/logs/9
```

> 注意：`file` 必须是服务器上真实存在的日志文件路径，前端 `●` 存活状态靠它判断。

### ③ 录入终端命令（右侧绿色 FAB → 命令抽屉）

> ⭐ **默认模式（强制）**：前后端一体命令 + `subgroup` 子分组（详见上文「终端自定义命令默认模式」）。每个日志分组推荐：`快速启动`（全部启动/全部关闭/安装公共包）+ `单平台(前后台一体)` + `停止(前后台一体)`。

```bash
# 全部启动（前后端一体，关联到 demo 日志分组 + 快速启动子分组）
curl -s -X POST http://localhost:3008/api/terminal/commands \
  -H 'Content-Type: application/json' \
  -d '{
    "label": "🚀 全部启动(前后端一体)",
    "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh start all",
    "group": "demo",
    "subgroup": "快速启动"
  }'
# → {ok:true, data:{id:"...", type:"custom", subgroup:"快速启动"}}

# 单平台（前后端一体，前后端一起起停）
curl -s -X POST http://localhost:3008/api/terminal/commands \
  -H 'Content-Type: application/json' \
  -d '{
    "label": "🚀 启动 main-platform(前后端一体)",
    "command": "bash /Users/owner/repository/demo-main/.claude/skills/my-start/start.sh start main main-vue",
    "group": "demo",
    "subgroup": "单平台(前后台一体)"
  }'

# 录入顺序：先写「快速启动」3 条 → 再各平台「启动」「停止」成对写入
# 录入完成后用 ?group= 验证（前端会自动按 subgroup 聚合成区块）
curl -s "http://localhost:3008/api/terminal/commands?group=demo"
```

### ④ 录入 Git 仓库（/git 页面 → + Add Repo）

```bash
# 注册仓库（模仿 238 上的 demo-main）
curl -s -X POST http://localhost:3008/api/git/repos \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "demo-main",
    "repoPath": "/home/demo/repository/demo-main",
    "notes": "238 主项目",
    "group": "prod"                  # 可选字符串标签
  }'
# → {ok:true, repo:{id:1, ...}}   # id 用于后续 /summary /diff /log /repo-browser

# 验证（三件套）
curl -s http://localhost:3008/api/git/summary/1     # 分支/是否干净/变更文件数
curl -s http://localhost:3008/api/git/diff/1        # 变更 diff
curl -s http://localhost:3008/api/git/repos         # 仓库列表
```

> 注意：`repoPath` 必须是服务器上真实存在的 git 仓库绝对路径；`/api/git/source` 和 `/api/repo-browser/*` 都做了路径穿越防护。

### 校验录入是否成功

```bash
# 三张总览（前端 /log 和 /sql 页面同源数据）
curl -s http://localhost:3008/api/config        # groups + databases + reviewMode
curl -s http://localhost:3008/api/logs          # 日志列表（含 exists/alive 状态）
curl -s http://localhost:3008/api/db            # 数据库连接（含 alive 健康检查）
```

---

## ⚠️ AI 绝对行为规范（严格遵守）

### 核心原则

| 操作类型 | Review Mode ON | Review Mode OFF |
|---------|---------------|-----------------|
| **SELECT 查询** | ✅ AI 可直接调用 `/api/sql/query` | ✅ AI 可直接调用 |
| **写入（INSERT/UPDATE/DELETE/ALTER…）** | ❌ **必须提交审批队列**，AI 不能自己执行 | ✅ AI 可直接执行 |
| **审批/拒绝操作** | ❌ **AI 绝对禁止调用 `/api/sql/approve/:id` 和 `/api/sql/reject/:id`** | N/A（无队列） |
| **开关评审模式** | ❌ **AI 绝对禁止调用 `/api/sql/review-mode`** | ❌ **AI 绝对禁止调用** |

### 详细规则

#### 1. SELECT 查询 — AI 可以自由调用

```bash
# ✅ AI 可以直接查
curl -s -X POST http://localhost:3008/api/sql/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT * FROM users LIMIT 10", "dbId":"mydb", "title":"查询用户列表"}'
```

#### 2. 写操作 — 受 reviewMode 管控

**Review Mode ON（默认）：**

```bash
# ❌ AI 禁止直接执行写入操作
# ✅ AI 必须提交到审批队列，然后通知用户去 /sql 审批
curl -s -X POST http://localhost:3008/api/sql/submit \
  -H 'Content-Type: application/json' \
  -d '{"sql":"UPDATE users SET status=1", "reason":"用户申请解封", "title":"解封用户", "dbId":"mydb"}'
# → { status: "pending" } → 告诉用户去 http://localhost:3008/sql 审批
```

**Review Mode OFF（配置关闭评审）：**

```bash
# ✅ AI 可以直接执行（需要先关 reviewMode）
# ⚠️ 但以下操作 AI 绝对不能自己做：
#   1. 绝对不能调 POST /api/sql/review-mode 来关评审模式
#   2. 必须由用户手动关闭评审模式后，AI 才能执行
```

#### 3. 🚫 AI 绝对禁止的操作（无论如何都不行）

```bash
# ❌ 绝对禁止 — AI 调了就是违规
POST /api/sql/approve/:id     # 自行审批 SQL
POST /api/sql/reject/:id      # 自行拒绝 SQL  
POST /api/sql/review-mode     # 自行开关评审模式
```

**禁止绕过的行为包括但不限于：**
- 直接调 `/api/sql/approve/:id` 批准自己的提交
- 偷偷关掉 reviewMode 再执行写入再恢复
- 用内联连接参数（`connection`）绕过队列直接执行
- 告诉用户"我不方便审批请你自己操作"（应该直接通知用户去面板操作）
- 任何让 AI 直接或间接执行审批动作的行为

#### 4. ✅ AI 可以做的

- **查询数据** — 自由调用 `/api/sql/query`
- **提交写入到队列** — 调 `/api/sql/submit` 然后通知用户
- **轮询任务状态** — 调 `/api/sql/status/:id` 查看是否已被审批
- **管理数据库连接** — 调 `/api/db` 相关接口
- **管理日志配置** — 调 `/api/log-config` 相关接口
- **查看历史记录** — 调 `/api/sql/history`

#### 5. 人工审核如何工作

1. AI 提交写入 SQL → 队列状态变为 `pending`
2. **必须告诉用户去 `http://localhost:3008/sql` 审批**
3. 浏览器会自动叮叮叮响铃提醒
4. 用户在面板点 Approve → SQL 被执行 → 记录历史
5. 用户在面板点 Reject → SQL 被拒绝
6. AI 可以轮询 `/api/sql/status/:id` 知道结果

#### 6. 如何关闭审批（静默模式）

**必须由用户自己操作：**
- 在 `http://localhost:3008/sql` 页面点 "Review Mode: ON" 按钮切换
- 或者手动改 `config.json` 里的 `"reviewMode": false`

---

## 新功能特性

### Git 仓库管理页（/git）
- 左侧仓库列表：分支、干净/变更状态、变更数、一键同步（pull-all）
- 点仓库展开 diff：文件级增删统计 + hunks 逐行（context/addition/deletion）
- 点文件切换 diff/source 视图；"🕒" 看提交历史（按天分组）
- 📂 按钮打开 **Repo Browser 弹窗**：完整文件树（目录优先）+ 文件预览（markdown 渲染 / 代码高亮）+ 文件历史 + Git 变更高亮

### 持久化终端（tmux）
- 命令抽屉（底部"命令终端"按钮）→ 点命令开一个 ttyd 终端窗口
- 持久化终端常驻服务器：刷新/断开不丢，重新点会话即重连；可彻底删除
- 终端窗口可拖动、可最小化，位置记忆在 localStorage

### 系统资源监控
- /log 工具栏两个圆环实时显示 CPU/内存占用
- 点击弹出详情：CPU/内存 30 点折线图 + 进程 TOP 30（内存排序）

### 自动备份
- 每天自动备份数据文件到 `backups/`（保留 10 天），工具栏"备份"按钮可立即备份 + 下载

### 右侧"AI 查询记录"面板
- 所有成功执行的 SQL（SELECT 和写入）自动记录
- 显示：标题 + 数据库 + SQL + 执行结果 + 时间
- 点击展开查看详情

### 🔔 审批声音提醒
- 有新的待审批 SQL 提交时，浏览器叮叮叮响
- 右侧面板标题栏有 🔔 按钮，点击停止响铃
- 全部审批完自动停铃

---

## 实现细节

### 存储

数据库连接 + 日志分组均存储在 `data/db-config.sqlite`。
首次启动自动从 `config.json` 迁移，之后 `config.json` 仅保留 `reviewMode`。
SQL 审批队列存储在 `sql-queue.json`。
AI 查询历史记录存储在 `sql-history.json`（保留最近 200 条）。
Git 仓库列表存储在 `data/git-repos.json`（JSON 数组，含 id/name/path/notes/group/时间戳）。
备份文件存储在 `backups/backup-<日期>.tar.gz`（每天自动 + 手动触发，保留最近 10 天）。

### 健康检查

启动时检查一次，之后每 60 秒自动检查。`/api/db` 响应含 `alive` / `lastCheck` / `serverVersion`。
前端面板用 ● alive / ○ dead / ◌ unknown 展示。

### 安全令牌

`/approve`、`/reject`、`/review-mode` 接口需要 `token` 验证。
令牌在服务启动时随机生成（8 位 hex），前端页面自动获取。

### config.json

```json
{ "reviewMode": true }
```
