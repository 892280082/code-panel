---
name: code-panel
description: >-
  运维控制面板(v3):JWT 登录 + 多项目(配置 = 项目内 .code-panel/*.yaml 文件)+ 应用服务实时日志与启停(Apps)、
  SQL 查询/审批、项目内 git 管理(diff/历史/文件浏览)、PRD 文档面板(MD→HTML+原型 iframe)、
  命令终端(项目自定义命令 + 系统预设 + tmux 持久会话)、浮动终端窗口、系统资源监控、
  云文件上传/下载(☁)、快捷方式 Quick Links(links.yaml)、环境变量组切换(右上 🅰,选用即全量重写
  ~/.code-panel/active-env.sh,新终端全局生效,命名 CODE_PANEL_*)、自动备份。
  用户说"看日志、追踪日志、查数据库、执行 SQL、审批 SQL、配数据库、看 git、git diff、浏览仓库代码、
  看PRD、写PRD、打开PRD、开终端、命令、tmux 会话、快捷方式、环境变量、环境组、切公司/切家、加项目、切换项目、备份、云文件、上传、下载、CPU 内存"时触发。
  启动端口 3008。全局唯一库 ~/.code-panel/data.db;项目配置文件在 <项目根>/.code-panel/。
---

## 认证(⭐ 先登录)

- 默认播种账号来自本仓库 `config.json` 的 `credentials`(首次启动 users 表为空时写入,role=超管;可改):**`admin / change-me`**(2026-09-07 改,旧 change-me 已废弃)。
- 登录页 `/login`;JWT 24h(settings.jwt.expiryHours 可配);除 `/api/auth/login` 外全部 `/api/*` 需令牌。
- 令牌三通道:`Authorization: Bearer <jwt>`(常规 fetch)/ `?token=<jwt>`(SSE、iframe、下载)/ `cp_auth` HttpOnly cookie(登录时下发,供同源 iframe 相对子资源自动带上)。
- 「记住我」= 记住登录态:勾选 → token 存 localStorage(刷新/重开浏览器免登录);不勾 → sessionStorage(关标签即登出)。
- 登录失败 14 次锁定(重启清零)。改密:`POST /api/auth/change-password`(登录态)。登出:`POST /api/auth/logout` + 前端清 storage。

## 多账号 + 项目级授权(2026-09-08)

- **两级角色**:种子账号 = `superadmin`(超管,见全部项目);超管创建的账号 = `user`(成员,仅见被分配的项目)。老库迁移自动把存量用户升级为超管。
- **信任模型**:只隔离项目可见性 —— 普通用户的项目列表(`GET /api/projects`)被过滤、项目级 API(`requireProject` 校验 user_projects 归属,未分配 → 403);**其余功能全部照常**(终端/tmux、SQL 查询与审批、备份、nginx、系统资源、安全模式、review-mode)。
- **超管专属**:① 用户管理 API(`/api/users` CRUD,member 403)② 项目注册表增删改(`POST/PUT/DELETE /api/projects` 及改名;yaml 读写跟随项目归属)。前端对应按钮(＋添加项目/编辑/移除/用户管理)仅超管可见,强制在后端。
- **用户管理界面**:⚙ → 账号 Tab(仅超管可见):左用户列表 / 右详情 —— 勾选即保存的项目分配、重置密码、删除账号(不能删自己)、＋添加用户(用户名 `[A-Za-z0-9_-]{2,32}`、初始密码 ≥4 位)。
- **role 实时生效**:JWT 里的 role 只是登录时快照(供前端 UI);后端每次请求查库取 role,超管改分配/删用户立即生效(被删用户的 token 立即 401)。
- API:`GET /api/users`(列表含 projectIds)/ `POST /api/users` `{username,password,projectIds?}` / `PUT /api/users/:name` `{password?|projectIds?}` / `DELETE /api/users/:name`;全部需超管。

## 安全模式(隐身/防探测,⚙ → 安全 Tab)

- **开启后**:未解锁的访问 —— 所有页面、静态资源、全部 API(连 `/api/auth/login`)—— 一律返回与 Express 默认无差别的 404,扫描器探测不到服务存在;WebSocket 终端升级同样直接断开。
- **解锁**:在任意访问入口(本机 `localhost:3008` / nginx 域名 / FRP 端口)后拼上**秘密路径**访问一次 → 种 `cp_gate` HttpOnly cookie(90 天)→ 自动 302 跳 `/login`,该浏览器此后一切正常。路径是唯一秘密,与入口域名无关。
- **管理**(⚙ → 安全):开关、查看/复制秘密路径、自定义路径(以 `/` 开头仅 `[A-Za-z0-9_-]` 长 8~128,不能以 `/api`、`/assets`、`/favicon` 开头)、⟳ 随机重新生成(128bit,旧路径立即失效)、🚪 吊销所有已解锁浏览器(换 cookieSecret,当前浏览器自动续上)。
- 配置存全局 settings 表 key=`security`(`{enabled,secretPath,cookieSecret}`),重启仍生效;开启/操作时后端自动给当前浏览器种 cookie(操作者不会把自己锁外面)。
- ⚠ **忘记秘密路径**:只能在本机查 `~/.code-panel/data.db` settings 表(CODE_PANEL_HOME 覆盖时查对应目录);238 部署机同理查其 `~/.code-panel/data.db`。
- API:`GET /api/config` 返回 `security:{enabled,secretPath}`(需 JWT);`PUT /api/config` body `security:{enabled?|secretPath?|regeneratePath?|revokeCookies?}`。

## 启动

```bash
bash ~/.claude/skills/code-panel/start.sh     # 端口 3008
# 开发: cd ~/.claude/skills/code-panel && npx tsx src/server.ts
```

## 访问面板

| 路径 | 用途 |
|------|------|
| `http://localhost:3008/login` | 登录页 |
| `http://localhost:3008/log`  | **Apps**:平台应用卡片 = 实时日志 + 圆点存活(右侧圆点 = 启停按钮)+ 日志页签 |
| `http://localhost:3008/sql`  | SQL 评审(查询/审批/DB 存活/历史) |
| `http://localhost:3008/prd`  | PRD 文档面板(分组目录 + MD 渲染 + 原型 iframe) |
| `http://localhost:3008/git`  | Git 管理(仓库 diff/历史/文件浏览/提交) |

- 左侧栏:**🗂 项目名 + 中文备注**(当前项目)→ 四个页签 Apps/SQL/PRD/Git;左上 ⚙ 打开配置(项目 / 备份 / 文件 / **nginx** / 账号)。
- **右上角常驻**(切到任意页签都在):📈 系统资源圆环(CPU/内存/磁盘)+ 🔗 快捷方式 Quick Links + 🅰 环境变量(环境组切换)。
- **右下浮动**:💻 命令终端抽屉(FAB + 1..N 终端芯片)、📂 仓库浏览、☁ 云文件抽屉。各页共用。
- 「＋ 添加项目」在 ⚙ → 项目:填 name/root/中文备注,自动生成 `.code-panel/` 骨架。当前项目存 localStorage `panel-project`。

---

## 存储模型(两层,⭐ 必懂)

```
~/.code-panel/                     # 全局(所有面板实例共享;CODE_PANEL_HOME 可覆盖)
└── data.db                        # 唯一全局库:users 账号 / projects 注册表(含中文备注 note)/ settings 公共配置
                                  #    + project_env 表(记录「项目 → 当前环境组」,source=user/default)
└── jwt.secret                     # JWT 密钥(自动生成 0o600)
└── active-env.sh                  # 「当前环境」物化脚本(code-panel 选用环境组时全量重写;
                                  #    被 shell rc source → 新终端全局生效;命名统一 CODE_PANEL_*)

<项目根>/.code-panel/              # 项目配置 = 提交式配置文件,随仓库走、可手改、修改即生效
├── .gitignore                     # data/ uploads/ downloads/(gitignore,不进仓库)
├── README.md                      # 本目录说明书(自动生成;每个 yaml 顶部注释 = 完整字段+示例)
├── apps.yaml                      # 「应用服务」:platforms → 每平台 backend/frontend 应用(日志 + 启停脚本)   ← 旧名 logs.yaml,兼容回退
├── sql.yaml                       # 数据库连接 connections:[{id,name,type,host/port/user/password/database|path,...}]
├── prd.yaml                       # PRD 目录 dir + folders:[{name,dir}]  —— 面板 /prd 左栏清单
├── git.yaml                       # 本项目 git 仓库 repos:[{id,name,path,notes?}]
├── commands.yaml                  # 命令抽屉「自定义命令」(启动/停止/一键…) 按钮
├── links.yaml                     # 「快捷方式」Quick Links(右上 🔗):groups → items → urls(多地址:域名/内网)
├── envs.yaml                      # 「环境变量组」(右上 🅰):groups → [{id,name,default?,vars{KEY:val}}];default=true 为兜底组
├── uploads/                       # ☁ 上传目录:浏览器传上来 → 复制绝对路径给终端/AI 用
├── downloads/                     # ☁ 下载目录:AI/命令把产物写进来 → 用户在面板点下载拿回
└── data/                          # 运行时数据(gitignore,随项目走;面板自动写,勿手改)
    ├── sql-history.json  sql-queue.json     # SQL 历史 / 审批队列
    ├── prd-status.json                      # PRD 目录完成态(路径→done)
    ├── tmux-notes.json                      # tmux 会话备注(归属本项目)
    └── cloud-config.json                    # ☁ 云上传/下载目录覆盖(默认以上,在 ⚙ →「文件」改)
```

- **加配置 = 改文件**:日志/库/命令/快捷方式/PRD/git 一律编辑上面对应的 yaml(每个文件顶部注释就是字段说明 + 示例),面板实时读取,无需走面板配置 API、无需重启。
- **旧分组(proj/proj-ark/pharma/test 等)已废弃**:不再从中央 sqlite 读取。要恢复某套配置,把它登记成项目并写好 `.code-panel/*.yaml`(旧数据在备份 tar.gz 里可查)。
- 面板级设置(reviewMode、jwt、ttyd、terminalDefaultCwd、备份路径)在全局 `settings`,不在项目里。
- 项目级所有接口必须带当前项目:`?project=<id>` 或头 `X-Project-Id`(POST 也接受 body.project)。

---

## 项目 / 配置 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 项目列表(含 name/root/note 中文备注) |
| POST | `/api/projects` | `{name, root, note?}` 添加并生成 `.code-panel/` 骨架 |
| PUT/DELETE | `/api/projects/:id` | 改名/换 root /改备注 / 注销(不删项目目录) |
| GET/PUT | `/api/projects/:id/yaml/:module` | 读写某模块 YAML(logs/sql/prd/git/commands/links;PUT body `{yaml:{...}}`)—— 等价于直接改项目里的 yaml 文件 |

## 认证 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | `{username,password,remember?}` → `{token,username}` + Set-Cookie |
| POST | `/api/auth/logout` | 清 cookie(需登录) |
| POST | `/api/auth/change-password` | `{oldPassword,newPassword}`(需登录) |

## Apps / 日志 API(作用域 ?project;数据源 = apps.yaml,旧 logs.yaml 兼容)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs?project=` | 该项目应用服务(platform/side/name/file/port/start/stop + exists/alive/active/size) |
| GET | `/api/log/content?project=&file=` | 读某服务日志文件内容(仅限该项目清单内) |
| POST | `/api/log/clear?project=` | 清空某日志文件 |
| GET | `/api/stream?project=&token=` | SSE:只推本项目日志 + 实时端口存活(portStatusMap,圆点与端口号数字同源) |
| GET | `/api/resources` | 系统资源(CPU/内存/磁盘)——右上资源圆环 |
| GET | `/api/resources/processes` | 进程 TOP(按内存排序,Linux 读数准) |

> Apps 页卡:平台一张卡,后端/前端两列;**每行右侧圆点 = 启停按钮**(有 start/stop 脚本时;悬停放大/呼吸,无脚本则纯状态点,点按落整行开日志)。点圆点 = 启动/停止,点服务行 = 打开日志页签,右键仍弹启停菜单。`file` 一律写相对项目根,面板补绝对。
>
> **启停 = 一次性命令反馈(keepShell=false),两种去向(2026-09-07 定)**:
> - **大窗展示 2s 内用户点中窗口** = 激活 → 窗口**一直保留**(可看后端慢启动的实时日志),手动 ✕ 才关,不自动收起。
> - **2s 内没点** → 自动收起成 LogView 工具栏左上角 **chip**(短时提示)。点 chip = **跳到该服务日志页**(真实 .logs 滚动),并关闭一次性会话;不点则 20s 后自动关闭回收。
> - ⚠️ 一次性命令(如 vite/服务启动)跑完即结束,大窗即使激活也没有后续交互输出(会停 reconnect)——激活保留主要给**后端慢启动**看过程用;前端快启动直接看 chip → 日志页。
> - **右下浮动终端的 1/2/3 数字条只列 tmux 常驻会话**;启停 oneshot 与手动 cmd 终端都不占数字(2026-09-07 定)。
> - 逻辑在前端 terminal store(oneshot/activated + 计时器),不依赖后端探测命令结束。

## 数据库连接 API(作用域 ?project;连接 = sql.yaml 文件,CRUD 写回该文件)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/db?project=` | 连接列表(含存活/版本) |
| POST/PUT/DELETE | `/api/db` 与 `/api/db/:id` | 增/改/删连接(写回 sql.yaml) |
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
| GET/POST/PUT/DELETE | `/api/git/repos` 与 `/api/git/repos/:id` | 本项目仓库 CRUD(写回 git.yaml) |
| GET | `/api/git/summary\|diff\|log\|source/:id` | 状态/diff/提交历史/源码 |
| POST | `/api/git/pull-all?project=` | 一键同步本项目仓库 |
| GET | `/api/repo-browser/:repoId/tree\|file\|diff\|file-log\|...` | 仓库文件树/预览/文件历史(带 ?project) |

## PRD API(作用域 ?project;目录清单 = prd.yaml)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/prd/folders?project=` | 目录清单(含文件数/完成态) |
| GET | `/api/prd/files\|content\|view\|file\|code-file` | MD 渲染/原型 iframe/代码视图(带 ?project 定位目录) |
| POST | `/api/prd/done` | `{project,dir,done}` 完成态 → 项目 data/prd-status.json |

## 命令 / 终端 API

命令抽屉三页签:**自定义**(来自 commands.yaml,提交式随仓库)/ **系统**(面板内置常量)/ **会话**(tmux 持久):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/terminal/commands` | 系统预设 + 该项目 commands.yaml 自定义命令(带 ?project) |
| POST/PUT/DELETE/reorder | `/api/terminal/commands...` | 改自定义命令(写回 commands.yaml);更推荐直接编辑 commands.yaml |
| POST | `/api/terminal/sessions` | 页面级命令终端(ttyd 9002-9011;`{label,command,cwd}`) |
| GET/DELETE | `/api/terminal/sessions` 与 `/sessions/:port` | 列表 / 关闭 |
| GET | `/api/terminal/status` | FAB 终端状态 |

tmux 持久会话(常驻宿主;备注存 data/tmux-notes.json;物理名 `p_<项目>_<名字>`):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/terminal/tmux/list?project=` | 会话列表 |
| POST | `/api/terminal/tmux/create` | `{project,name,description?}` 新建 |
| POST | `/api/terminal/tmux/attach` | `{project,name}` → `{port}`(ttyd 9020-9029) |
| DELETE | `/api/terminal/tmux-sessions/:port` | 断开接入(不杀会话) |
| DELETE | `/api/terminal/tmux/:name` | 彻底删除(断开+kill+删备注) |

> 前端 iframe 统一 `/api/terminal/<port>/?token=<jwt>`;终端代理(HTTP+WS)都校验 JWT(`?token=`/cookie/Bearer)。

## 快捷方式 Quick Links(links.yaml)

右上 🔗 下拉,内容 = 项目 links.yaml `groups`(纯展示 + 打开,提交式随仓库走)。结构:

```yaml
groups:
  - name: 域名/内网…            # 组名
    items:
      - name: 门户首页
        urls: [ { label: 域名, url: "dev.example.com" }, { url: "http://127.0.0.1:7165" } ]  # 1..N 多环境地址
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/links?project=` | 读该项目 links.yaml 分组结构 |

改快捷方式 = 编辑项目 `links.yaml`(或 PUT yaml 模块),无需走链接 CRUD API。

## 环境变量组 Env(右上 🅰;作用域 ?project;数据源 = envs.yaml + 全局库 project_env)

把"公司/家"这类**场景端点**(DB/Redis 的 host/port 等)做成可命名、可切换、启动即注入的**环境组**。托管变量统一 `CODE_PANEL_*` 命名,方便审计已用数量。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/env?project=` | 组列表 + 当前生效组(只读) |
| POST | `/api/env/ensure` | 打开项目兜底:没设置过 → 自动落 `default:true` 组并物化(零配置可跑) |
| POST | `/api/env/activate` | `{groupId}` 选用 → 写库(source=user)+ 全量重写 active-env.sh + 确保 shell rc 挂载 |
| POST | `/api/env/reset` | 清除手动选择 → 回落默认组 |
| POST | `/api/env/mount` | 手动补挂 shell rc(幂等;一般由 activate 自动做) |

**机制**
- **定义**:项目 `.code-panel/envs.yaml`(提交式):`groups: [{id,name,default?,vars{CODE_PANEL_*: val}}]`;`default:true` = 该项目默认兜底组。
- **记录**:全局库 `project_env`(`project_id → group_id`,source `user`/`default`)。
- **生效 = 全量重写** `~/.code-panel/active-env.sh`(注释头 + export,原子写);被 shell rc source → **新终端全局生效**(已开终端需新开或手动 source)。
- **code-panel 终端/启停自动带上**:`ttyd-manager` 每次 spawn 把 active-env.sh 的 `CODE_PANEL_*` 合并进进程环境(bash 不 source ~/.zshrc,须显式注入)。
- **应用侧**:`application.yml` 用 `${CODE_PANEL_DB_HOST:默认}:${CODE_PANEL_DB_PORT:默认}/…` 占位读;**application-dev.yml 一律不提交**(本地自建,已被 gitignore)。
- 改组 = 直接编辑 `envs.yaml`;切换 = 右上「🅰 环境」选用或 `/api/env/activate`。

## 文件 API(☁ 云上传/下载;作用域 ?project)

右下 ☁ chip 打开云抽屉 = 与本机换文件的两个目录(默认 `<项目根>/.code-panel/uploads` 与 `downloads`,可在 ⚙ →「文件」改,存 data/cloud-config.json):

| 端点 | 作用 |
|------|------|
| GET/PUT `/api/files/config` | 读/改当前项目上传、下载目录(空串=恢复默认) |
| GET `/api/files?side=upload\|download` | 列该目录文件(新→旧) |
| POST `/api/files/upload` | multipart `files` 多文件 → 上传目录 |
| POST `/api/files/paste-image` | `{dataUrl}` 剪贴板图片 → 上传目录 |
| GET `/api/files/raw?side=&name=` | 读文件内容(inline;前端拼 `?token=` 供缩略图/下载) |

## 备份 API

备份收进 ⚙ →「备份」Tab:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/backup/config` | 备份路径(存全局 settings.backup.path) |
| POST | `/api/backup/run` | 立即备份:打包全局 data.db + 每个注册项目的 `.code-panel/` |
| GET | `/api/backup/list` | 备份列表 |
| GET | `/api/backup/download/:name` | 下载(`?token=`/cookie) |

> 同日同名覆盖、保留最近 20 份;程序每次启动自动备份一次。

## nginx API(⚙ → nginx Tab;作用域 ?project)

检测当前项目 `.code-panel/nginx/*.conf` 是否被**本机**(code-panel 运行所在机器)nginx 加载/生效。conf 源目录 = `<项目根>/.code-panel/nginx/`(直接读 .conf 文件,非 yaml 模块)。

| 端点 | 作用 |
|------|------|
| GET `/api/nginx/status?project=` | 本机 nginx:bin/版本/主 conf/include 目录/master pid/是否运行 |
| GET `/api/nginx/confs?project=` | 项目 `.code-panel/nginx/` 下 .conf 列表 |
| GET `/api/nginx/conf?project=&file=` | 读某 conf 内容(仅限该项目 nginx 目录内 .conf) |
| POST `/api/nginx/check?project=` body `{file}` | `nginx -t` 语法 + server_name 是否被本机加载(`nginx -T` 比对)+ 项目副本 vs 本机 include 目录同名 conf md5 一致性 |
| GET/PUT `/api/nginx/config` | 全局 override `settings.nginx={bin?,confPath?}`(留扩展,自动探测失败才需手动) |

> 只读检测,不做 reload/同步(本机 nginx master 通常 root,写操作需 sudo,避免复杂度)。
> md5 比对口径:项目 `.code-panel/nginx/dev.example.com.conf`(唯一可改源)vs 本机 include 目录同名文件 → 一致 ✓ / 不一致 ⚠(提示"已改未应用")/ 本机无此文件。

## 全局配置(settings)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | `{reviewMode, ttyd?, terminalDefaultCwd?, jwt?}` |
| PUT | `/api/config` | 仅更新 `reviewMode` |

---

## PRD 指令(用户说「PRD」时执行)

> 触发词:PRD、写PRD、设计原型、打开PRD、PRD面板、改版、方案文档。写 PRD 前必读 `references/prd-directory-format.md`;模板在 `templates/prd/`(**复制即用,禁止自创结构**)。

**标准结构**:PRD 根目录下总看板 `index.md` + `plan/{todo,doing,done}` 三态目录;子计划放 `plan/doing/<计划名>/`,含入口 `index.md`、每步 `步骤N-<名称>.md`、原型 `原型-<页面>.html`、`伪代码/` 目录。每步文档必备:🖼 原型图(`` `> 原型图:`原型-<页面>.html` `` 面板自动 iframe 内联)、🔀 mermaid 流程图(必须配数据结构+文字流程双份)、📂 菜单清单、📋 表结构(逐字段 + 【库】归属 + 码值)、💻 伪代码(`> @tabs 步骤N` 在 MD 内渲染)。

**创建流程(一条龙,一次到位)**:① `cp -r templates/prd/* <PRD根>/` → ② 填总看板 index.md → ③ 子计划入口 index.md(背景/目标/核心流程/步骤导航/核心差异)→ ④ 每步一个 md(介绍含原型图/表结构/流程/流程图/菜单/伪代码 Tab)→ ⑤ 写 `伪代码/步骤N-<端>-<功能>.ts` → ⑥ 在 **该项目 `.code-panel/prd.yaml`** 的 folders 注册目录 → ⑦ 面板 /prd 验收。

> 渲染:MD 里 `` `> 原型图:`<原型路径>.html` `` 会内联 iframe;原型 HTML 的相对 css/js 子资源靠 `cp_auth` cookie 自动带上,无需 token 参数。文件夹/原型多放 `<项目根>/.code-panel/prd/` 下(按人分目录),随仓库共享。

## 给 demo 这类项目加日志 / 库 / 命令 / 快捷 / PRD / git

**配置文件放在项目里,AI 直接改文件即可**(面板实时读取,改完即生效;文件随仓库提交)。推荐直接编辑而不是走 curl:

```bash
# 例:给项目加一个应用服务(日志+启停)→ 编辑 <项目根>/.code-panel/apps.yaml(旧 logs.yaml 兼容)
#   platforms:
#     - name: 主平台
#       backend:  [ { name: main, file: .logs/main.log, port: 7123,
#                      start: "bash .claude/skills/fast-start/start.sh start main",
#                      stop:  "bash .claude/skills/fast-start/start.sh stop main" } ]
#       frontend: [ { name: main-vue, file: .logs/main-front.log, port: 7124 } ]
# 库:改 sql.yaml;命令:改 commands.yaml;快捷方式:改 links.yaml;PRD:改 prd.yaml;git:改 git.yaml
```

> 每份 yaml 顶部注释 = 完整字段说明 + 示例(去掉注释即生效)。程序化写全量时才用 `PUT /api/projects/:id/yaml/:module`。

### ⚠️ apps.yaml 的 start/stop 脚本必须自己保活(AI 写配置前必读,2026-09-08 实案)

点「启动」= 面板在**一次性终端**(ttyd oneshot,keepShell=false)里执行 start 命令:大窗 2s 收起、20s 自动关闭回收。会话关闭时 SIGHUP 会把脚本里刚 fork 的服务进程**连带杀掉**——现象是「点了启动,日志只有一行分隔线,服务秒死、端口永远起不来」。所以 **start 引用的 sh 必须自己保活**,三个要素缺一不可:

1. **脚本顶部 `trap '' HUP`** —— 整个 shell 及子进程免疫会话关闭信号(方舟/demo-v2 2026-08-11 教训;proj-v3 平移时漏了这行,排查半天)
2. **daemonize 启动服务**(python 单 fork + setsid + execvp,脱离终端会话),不能裸 `cmd &`
3. **日志重定向到文件**(相对项目根,如 `.logs/xxx.log`),与 apps.yaml 的 `file` 一致

标准写法(参考任意已跑通项目的 `fast-start/scripts/lib.sh`):

```bash
# lib.sh
trap '' HUP                       # ⭐ 必须有:忽略 SIGHUP,否则 oneshot 会话关闭服务秒死
daemonize() {
    python3 -c '
import os, sys
if os.fork() != 0: os._exit(0)
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])
' "$@"
}
start_xxx() {
    kill_port <port>
    cd "$ROOT/<dir>" || return 1
    echo "--- xxx (<port>) ---" >> "$ROOT/.logs/xxx.log"
    daemonize <启动命令> >> "$ROOT/.logs/xxx.log" 2>&1 &
}
```

**验收标准**:面板点启动 → 不碰大窗让它收起/回收 → 服务端口仍存活(Apps 圆点变绿)、日志文件持续滚动。
另:排查 ttyd 链路时,**必须带 WebSocket 客户端连接**——ttyd 是每个客户端连接时才执行一次命令,裸起 ttyd 模拟面板会得到「命令从未执行」的假象,极易误判成信号问题。

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

- 全局数据根统一走 `src/paths.ts`(`os.homedir()/.code-panel`);项目 `.code-panel` 在项目内。
- 模块 YAML:日志 → `apps.yaml`(旧 `logs.yaml` 兼容回退,见 `paths.ts`/`project-store.ts`);sql/prd/git/commands/links 各一文件。加载即读(js-yaml,容错默认空),写即全量重写;文件内路径写「相对项目根」,读取时补绝对。
- 连接池/健康检查 key = `projectId:dbId`;日志监控扫所有注册项目 apps.yaml 并集,SSE 按项目过滤。
- JWT 密钥在 `~/.code-panel/jwt.secret`(自动生成,重启 token 仍有效)。`auth-token.ts` 的 REVIEW_TOKEN 用于 SQL 审批,与 JWT 并存。
