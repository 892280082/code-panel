---
name: code-panel
description: >-
  运维控制面板(改版 v3):JWT 登录 + 多项目(.code-panel YAML)+ 实时日志追踪、SQL 查询/审批、
  项目内 git 管理(变更 diff/历史/文件浏览)、PRD 文档面板(MD→HTML+原型 iframe)、
  持久化终端(命令抽屉 + tmux 会话 + ttyd 接入)、系统资源监控、云文件上传/下载(☁)、自动备份。
  用户说"看日志、追踪日志、查数据库、执行 SQL、审批 SQL、配置数据库、看 git、git diff、浏览仓库代码、
  看PRD、写PRD、打开PRD、开终端、tmux 会话、添加项目、切换项目、备份、云文件、上传、下载、CPU 内存"时触发。
  启动端口 3008。前端 Vue 3 + Pinia + Vue Router;全局数据 ~/.code-panel/data.db,项目数据在 <项目根>/.code-panel/。
---

## 认证(⭐ 先登录)

- 默认播种账号来自本仓库 `config.json` 的 `credentials`(首次启动 users 表为空时写入;可改):`demo / change-me`。
- 登录页 `/login`;JWT 24h(settings.jwt.expiryHours 可配);除 `/api/auth/login` 外全部 `/api/*` 需令牌。
- 令牌三通道:`Authorization: Bearer <jwt>`(常规 fetch)/ `?token=<jwt>`(SSE、iframe、下载)/ `cp_auth` HttpOnly cookie(登录时下发,供同源 iframe 相对子资源自动带上)。
- 「记住我」= 记住登录态:勾选 → token 存 localStorage(刷新/重开浏览器免登录);不勾 → sessionStorage(关标签即登出)。
- 登录失败 14 次锁定(重启清零)。改密:`POST /api/auth/change-password`(登录态)。登出:`POST /api/auth/logout` + 前端清 storage。

## 启动

```bash
bash ~/.claude/skills/code-panel/start.sh     # 端口 3008
# 开发: cd ~/.claude/skills/code-panel && npx tsx src/server.ts
```

## 访问面板

| 路径 | 用途 |
|------|------|
| `http://localhost:3008/login` | 登录页 |
| `http://localhost:3008/log` | 日志查看(实时 SSE + 端口存活) |
| `http://localhost:3008/sql` | SQL 评审(审批/拒绝 + DB 存活 + 查询历史) |
| `http://localhost:3008/git` | Git 管理(仓库 diff/历史/文件浏览) |
| `http://localhost:3008/prd` | PRD 文档面板(分组目录 + MD 渲染 + 原型 iframe + 完成状态) |

> 登录后:左侧「项目」下拉切换当前项目 → 四模块(logs/sql/prd/git)+ 命令抽屉/快捷启动全部跟随该项目。「＋」添加项目(填 name+root,自动生成 `.code-panel/` 骨架)。当前项目存 localStorage `panel-project`。

---

## 存储模型(严格两层,⭐ 必懂)

```
~/.code-panel/                     # 全局(所有实例共享;CODE_PANEL_HOME 可覆盖)
├── data.db                        # users 账号 / projects 注册表 / settings 公共配置
└── jwt.secret                     # JWT 密钥(自动生成 0o600)

<项目根>/.code-panel/
├── .gitignore                     # data/ uploads/ downloads/
├── logs.yaml                      # sections:[{name, logs:[{name,file,port?}]}]  —— 日志清单
├── sql.yaml                       # connections:[{id,name,type,host/port/user/password/database|path,...}] —— 本项目数据库连接
├── prd.yaml                       # dir + folders:[{name,dir}]  —— PRD 目录清单
├── git.yaml                       # repos:[{id,name,path,notes?}] —— 本项目 git 仓库(字符串 id)
├── uploads/                       # ☁ 云上传目录(gitignore)——浏览器传上来,复制绝对路径给终端/AI 用
├── downloads/                     # ☁ 云下载目录(gitignore)——AI 把文档/产物写进来,用户在面板点下载拿回
└── data/                          # 运行时数据(gitignore,随项目走)
    ├── sql-history.json  sql-queue.json     # SQL 历史 / 审批队列
    ├── prd-status.json                      # PRD 目录完成态(路径→done)
    ├── commands.json  launch-links.json     # 命令抽屉自定义命令 / 快捷启动
    ├── tmux-notes.json                      # tmux 会话备注(归属本项目)
    └── cloud-config.json                    # 云上传/下载目录覆盖(默认以上,配置在 ⚙ →「文件」改)
```

- **旧分组(proj/proj-ark/pharma/test 等)已废弃**:不再从中央 sqlite 读取。要恢复某套配置,把它登记成项目并写好 `.code-panel/*.yaml`(旧数据在备份 tar.gz 里可查)。
- 面板级设置(reviewMode、jwt、ttyd、terminalDefaultCwd、备份路径)在全局 `settings`,不在项目里。
- 项目级所有接口必须带当前项目:`?project=<id>` 或头 `X-Project-Id`(POST 也接受 body.project)。

---

## 项目 / 配置 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | `{id?,name,root}` 添加并生成 `.code-panel/` 骨架 |
| PUT/DELETE | `/api/projects/:id` | 改名/换 root / 注销(不删项目目录) |
| GET/PUT | `/api/projects/:id/yaml/:module` | 读写模块 YAML(logs/sql/prd/git;PUT body `{yaml:{...}}`) |

## 认证 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | `{username,password,remember?}` → `{token,username}` + Set-Cookie |
| POST | `/api/auth/logout` | 清 cookie(需登录) |
| POST | `/api/auth/change-password` | `{oldPassword,newPassword}`(需登录) |

## 日志 API(作用域 ?project)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs?project=` | 该项目 logs.yaml 条目(含 exists/alive/size) |
| GET | `/api/log/content?project=&file=` | 读文件内容 |
| POST | `/api/log/clear?project=` | 清空某日志 |
| GET | `/api/stream?project=&token=` | SSE:只推本项目日志 + 全局端口状态 |
| GET | `/api/resources` | 系统资源(CPU/内存/磁盘) |

## 数据库连接 API(作用域 ?project;连接存 sql.yaml)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/db?project=` | 连接列表(含存活/版本) |
| POST/PUT/DELETE | `/api/db` 与 `/api/db/:id` | 增/改/删(写回 sql.yaml) |
| POST | `/api/db/test` | 直连测试(内联参数) |
| POST | `/api/db/refresh?project=` | 刷新本项目连接健康 |

## SQL 执行/评审(作用域 ?project;历史/队列落项目 data/)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sql/query` | SELECT 直查 |
| POST | `/api/sql/submit` | 写操作提交审批(reviewMode 下进队列) |
| GET | `/api/sql/status/:id` | 任务状态 |
| GET | `/api/sql/history` | 本项目历史(200 条) |
| GET | `/api/sql/queue` | 审批队列 |
| POST | `/api/sql/approve/:id` `reject/:id` | 审批(需 body `token`=REVIEW_TOKEN) |
| GET/POST | `/api/sql/review-mode` | 全局评审模式开关(需 REVIEW_TOKEN;AI 禁止调用) |

> dbId 在本项目 sql.yaml 内解析;支持 `connection` 内联直连。REVIEW_TOKEN 为启动随机 8 位 hex(重启刷新)。

## Git API(作用域 ?project;仓库 id 为字符串,存 git.yaml)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST/PUT/DELETE | `/api/git/repos` 与 `/api/git/repos/:id` | 本项目仓库 CRUD |
| GET | `/api/git/summary\|diff\|log\|source/:id` | 状态/diff/提交历史/源码 |
| POST | `/api/git/pull-all?project=` | 一键同步本项目仓库 |
| GET | `/api/repo-browser/:repoId/tree\|file\|diff\|file-log\|...` | 仓库文件树/预览/文件历史(带 ?project) |

## PRD API(作用域 ?project;文件夹清单存 prd.yaml)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/prd/folders?project=` | 目录清单(含文件数/完成态) |
| GET | `/api/prd/files\|content\|view\|file\|code-file` | MD 渲染/原型 iframe/代码视图(带 ?project 定位目录) |
| POST | `/api/prd/done` | `{project,dir,done}` 完成态 → 项目 data/prd-status.json |

## 终端 API

命令抽屉自定义命令按项目存 `data/commands.json`(系统预设为全局只读):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST/PUT/DELETE/reorder | `/api/terminal/commands` | 自定义命令 CRUD + 排序(带 ?project) |
| POST | `/api/terminal/sessions` | 页面级命令终端(ttyd 9002-9011) |
| GET/DELETE | `/api/terminal/sessions` 与 `/api/terminal/sessions/:port` | 列表/关闭 |

tmux 持久会话(会话常驻宿主;备注存归属项目 data/tmux-notes.json;物理名 `p_<项目>_<名字>`):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/terminal/tmux/list?project=` | 会话列表(带 project 归属) |
| POST | `/api/terminal/tmux/create` | `{project,name,description?}` 新建 |
| POST | `/api/terminal/tmux/attach` | `{project,name}` → `{port}`(ttyd 9020-9029) |
| DELETE | `/api/terminal/tmux-sessions/:port` | 断开接入(不杀会话) |
| DELETE | `/api/terminal/tmux/:name` | 彻底删除(断开+kill+删备注) |

> 前端 iframe 统一 `/api/terminal/<port>/?token=<jwt>`;终端代理(HTTP+WS)都校验 JWT(`?token=`/cookie/Bearer),未带令牌 401/403。

## 文件 API(☁ 云上传/下载;作用域 ?project)

面板右下角 ☁ chip 打开云抽屉 = 与本机换文件的两个目录(默认 `<项目根>/.code-panel/uploads` 与 `downloads`,可在 ⚙ →「文件」改,存 data/cloud-config.json):

| 端点 | 作用 |
|------|------|
| GET/PUT `/api/files/config` | 读/改当前项目上传、下载目录(空串=恢复默认) |
| GET `/api/files?side=upload\|download` | 列该目录文件(新→旧) |
| POST `/api/files/upload` | multipart `files` 多文件 → 上传目录 |
| POST `/api/files/paste-image` | `{dataUrl}` 剪贴板图片 → 上传目录 |
| GET `/api/files/raw?side=&name=` | 读文件内容(inline;前端拼 `?token=` 供缩略图/下载) |

## 备份 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/backup/config` | 备份路径(存全局 settings.backup.path) |
| POST | `/api/backup/run` | 立即备份:打包 `global.code-panel/`(data.db+jwt.secret)+ 每个注册项目的 `.code-panel/` |
| GET | `/api/backup/list` | 备份列表 |
| GET | `/api/backup/download/:name` | 下载(`?token=`/cookie) |

> 同日同名覆盖、保留最近 20 份;程序每次启动自动备份一次。

---

## 全局配置(settings)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/config` | `{reviewMode, ttyd?, terminalDefaultCwd?, jwt?}`(PUT 仅改 reviewMode) |

---

## PRD 指令(用户说「PRD」时执行)

> 触发词:PRD、写PRD、设计原型、打开PRD、PRD面板、改版、方案文档。写 PRD 前必读 `references/prd-directory-format.md`;模板在 `templates/prd/`(**复制即用,禁止自创结构**)。

**标准结构**:`<项目>/PRD/` 下总看板 `index.md` + `plan/{todo,doing,done}` 三态目录;子计划放 `plan/doing/<计划名>/`,含入口 `index.md`、每步 `步骤N-<名称>.md`、原型 `原型-<页面>.html`、`伪代码/` 目录。每步文档必备:🖼 原型图(`` `> 原型图:`原型-<页面>.html` `` 面板自动 iframe 内联)、🔀 mermaid 流程图(必须配数据结构+文字流程双份)、📂 菜单清单、📋 表结构(逐字段 + 【库】归属 + 码值)、💻 伪代码(`> @tabs 步骤N` 在 MD 内渲染)。

**创建流程(一条龙,一次到位)**:① `cp -r templates/prd/* <项目>/prd/` → ② 填总看板 index.md → ③ 子计划入口 index.md(背景/目标/核心流程/步骤导航/核心差异)→ ④ 每步一个 md(介绍含原型图/表结构/流程/流程图/菜单/伪代码 Tab)→ ⑤ 写 `伪代码/步骤N-<端>-<功能>.ts` → ⑥ 在 **该项目 `.code-panel/prd.yaml`** 的 folders 注册目录 → ⑦ 面板 /prd 验收。

> 渲染:MD 里 `` `> 原型图:`<原型路径>.html` `` 会内联 iframe;原型 HTML 的相对 css/js 子资源靠 `cp_auth` cookie 自动带上,无需 token 参数。

## 给 demo 加日志 / 库 / 仓库 / PRD

```bash
# 示例:改 demo 项目日志(yaml 全量覆盖)
curl -s -X PUT http://localhost:3008/api/projects/demo/yaml/logs \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' \
  -d '{"yaml":{"sections":[{"name":"后端","logs":[{"name":"main-platform","file":"<项目根>/code/backend/apps/main-platform/logs/mvn-console.log","port":3100}]}]}}'
# 库:改 sql.yaml;仓库:改 git.yaml;PRD:改 prd.yaml(或直接手改项目里 .code-panel/*.yaml,面板实时读取)
```

---

## ⚠️ AI 绝对行为规范(严格遵守)

| 操作 | ReviewMode ON | ReviewMode OFF |
|---|---|---|
| SELECT 查询 | ✅ 直接 `/api/sql/query` | ✅ 直接 |
| 写操作(INSERT/UPDATE/DELETE/ALTER) | ❌ 只能 `/api/sql/submit` 进队列,通知用户去 /sql 审批 | ✅ 直接 |
| 审批/拒绝 `/api/sql/approve·reject` | ❌ **AI 绝对禁止** | N/A |
| 开关 `/api/sql/review-mode` | ❌ **AI 绝对禁止** | ❌ 禁止 |

- 禁止:自行审批、自行关 reviewMode、用 `connection` 内联绕过队列、任何绕过审批动作。
- SELECT 自由查;写操作在 reviewMode 下必须 submit 并**明确告诉用户去 `http://localhost:3008/sql` 审批**(页面会响铃)。
- 所有 sql 调用记得带 `?project=<id>`。
- ReviewMode 关闭需用户手动操作(页面上点开关或全局配置),AI 绝不代劳。

**交付文件给用户(☁ 云文件通道)**:
- 用户要你看图 / 给你文件时:文件在其项目 `<项目根>/.code-panel/uploads/`,绝对路径可直接引用(用户面板 ☁ 上传后复制给你);找不到就 `GET /api/files?project=<id>&side=upload` 看清单。
- 你要交付文档/产物给用户时:写到 `<项目根>/.code-panel/downloads/` 并告诉用户「已放到下载目录,去面板 ☁ → ⬇ 下载」。写入前先 `GET /api/files/config?project=<id>` 确认确切目录(用户可能改过默认);该目录 gitignore,不进仓库。

## 实现细节备忘

- 全局数据根统一走 `src/paths.ts`(`os.homedir()/.code-panel`);项目 `.code-panel` 与运行数据在项目内。
- 模块加载即读 `.code-panel/*.yaml`(js-yaml,容错默认空);写即全量重写 yaml。
- 连接池/健康检查 key = `projectId:dbId`;日志监控扫所有注册项目 logs.yaml 并集,SSE 按项目过滤。
- JWT 密钥在 `~/.code-panel/jwt.secret`(自动生成,重启 token 仍有效)。`auth-token.ts` 的 REVIEW_TOKEN 用于 SQL 审批,与 JWT 并存。
