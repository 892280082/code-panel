---
name: code-panel
description: 运维面板(端口 3008):应用日志/启停、SQL 查询审批、Redis、Git diff、PRD 文档、终端、备份、nginx。配置即项目内 .code-panel/*.yaml。AI 用仓库根 cp 脚本本机免密调用全部 API。
---

# code-panel(运维面板)

单机运维面板:管你机器上所有项目的 **应用日志与启停 / SQL 查询与审批 / Redis / Git diff / PRD 文档 / 终端 / 备份 / nginx**。一切项目配置 = 项目里 `.code-panel/*.yaml`(提交式,改完即生效);面板运行时数据在 `~/.code-panel/`(gitignore)。

## 启动与访问

```bash
bash ~/.claude/skills/code-panel/start.sh    # 端口 3008;开发:npx tsx src/server.ts
```

| 路径 | 用途 |
|---|---|
| `http://localhost:3008/login` | 登录页(默认账号:仓库 `config.json` 的 `credentials`,首次启动播种为超管) |
| `/log` `/sql` `/redis` `/prd` `/git` | Apps(卡片+日志页签)/ SQL 评审 / Redis / PRD 文档 / Git |

左侧栏页签 + 左上 ⚙ 配置(项目/备份/文件/nginx/安全/账号);右上资源圆环 + 🔗 快捷 + 🅰 环境组;右下浮动:💻 命令终端、📂 仓库浏览、☁ 云文件。

## ⭐ AI 核心工作流(必须遵守)

### 1. 调面板接口一律用 `cp`(本机免密)

```bash
bash ~/.claude/skills/code-panel/cp get  /api/inspect?project=4
bash ~/.claude/skills/code-panel/cp get  /api/logs?project=4
bash ~/.claude/skills/code-panel/cp post /api/sql/query -d '{"dbId":"hq","sql":"select 1"}'
bash ~/.claude/skills/code-panel/cp raw  /api/stream?project=4      # 不解析信封
```

- 鉴权由脚本内部自理(`~/.code-panel/ai-token`,0600,仅本机可读 = 本机免密;**安全模式开着也直通,外网拿不到 token 照样全 404**)
- `project` 传注册表 **id**(数字,先 `cp get /api/projects` 查),不是项目名
- 调用者不需要知道端口/密码/token/安全模式开关的任何细节

### 2. 改完任何 `.code-panel/*.yaml` → 一发自检

```bash
bash ~/.claude/skills/code-panel/cp get "/api/inspect?project=<id>"
```

返回:各模块条目数/mtime/YAML 解析错误、sql/redis 连接**插值后的实际 host + 存活 + 版本**(密码脱敏)、应用端口探活、当前环境组生效 vars、静态校验 errors。**不要开页面肉眼验证,不要问用户「生效了没」。**

### 3. SQL 铁律(ReviewMode)

| 操作 | ReviewMode ON | OFF |
|---|---|---|
| SELECT | ✅ `/api/sql/query` | ✅ 直接 |
| INSERT/UPDATE/DELETE/ALTER | ❌ 只能 `/api/sql/submit` 进队列,**明确告诉用户去 `http://localhost:3008/sql` 审批**(页面会响铃) | ✅ 直接 |
| approve / reject / review-mode 开关 | ⛔ **绝对禁止**(ai-token 通道已被后端 403 硬拦) | ⛔ 同左 |

禁止:自行审批、自行关 reviewMode、用 `connection` 内联绕队列。

### 4. 云文件通道(给用户交付/收文件)

- 用户给你文件 → 在项目 `<项目根>/.code-panel/uploads/`(面板 ☁ 上传);找文件先 `cp get "/api/files?project=<id>&side=upload"`
- 交付产物给用户 → 写入 `.code-panel/downloads/` 并告知「☁ → ⬇ 下载」;写入前先 `cp get "/api/files/config?project=<id>"` 确认目录(用户可能改过)

## 存储模型(两层,⭐ 必懂)

```
~/.code-panel/                    # 全局(CODE_PANEL_HOME 可覆盖;所有实例共享)
├── data.db                       #   users / projects 注册表 / settings(面板级配置)
├── jwt.secret · ai-token         #   登录密钥 / 本机免密 token(0600)
└── active-env.sh                 #   当前环境组物化脚本(shell rc source → 新终端生效)

<项目根>/.code-panel/             # 项目配置 = 提交式文件,随仓库走、可手改、修改即生效
├── apps.yaml                     # 应用服务(日志+启停;⚠ start 脚本保活铁律见 references/apps-lifecycle.md)
├── sql.yaml / redis.yaml         # 连接清单(host 支持 "${VAR:默认}" 环境变量占位,跨机器切换)
├── envs.yaml                     # 环境变量组(右上 🅰;切换=全量重写 active-env.sh 并注入终端)
├── prd.yaml / git.yaml / links.yaml / commands.yaml
├── nginx/                        # 项目 nginx conf 副本(检测本机是否加载)
├── uploads/ downloads/           # ☁ 云文件(用户可改,见 /api/files/config)
└── data/                         # 运行时(gitignore:sql 历史/审批队列/PRD 完成态/tmux 备注)
```

- **加配置 = 改文件**:每个 yaml 顶部注释就是字段说明书 + 示例,面板实时读取
- 项目级接口必须带 `?project=<id>`;普通用户(非超管)仅可见被分配的项目

## 环境变量组(跨机器零改配置)

`envs.yaml` 定义组(`groups: [{id,name,default?,vars}]`);右上 🅰 切换 → 全量重写 `~/.code-panel/active-env.sh`(shell rc source 生效)+ 面板终端/启停自动注入。应用侧 yml 写 `${CODE_PANEL_DB_HOST:默认}` 占位读;**写 yaml 时占位符值必须加引号**(flow mapping 里裸 `${a:b}` 会 YAML 解析炸)。

## PRD 指令(用户说「PRD/写PRD/原型/方案文档」时)

写 PRD 前必读 `references/prd-directory-format.md`;模板在 `templates/prd/`(**复制即用,禁止自创结构**)。一条龙:cp 模板 → 填总看板 index.md → 子计划(入口 index + 步骤 md + 原型 html + 伪代码/)→ 在项目 `.code-panel/prd.yaml` 的 folders 注册 → `cp get /api/prd/folders?project=<id>` 验收。

## 子文档索引(按需读)

| 文档 | 内容 |
|---|---|
| [references/api-reference.md](references/api-reference.md) | 全部 API 按模块速查表 |
| [references/apps-lifecycle.md](references/apps-lifecycle.md) | apps.yaml 字段 + 启停 oneshot 语义 + **start 脚本保活三大坑(AI 写 apps.yaml 前必读)** |
| [references/accounts-security.md](references/accounts-security.md) | 多账号/项目授权/安全模式/ai-token 机制 |
| [references/prd-directory-format.md](references/prd-directory-format.md) | PRD 目录结构与文档格式 |
