---
name: code-panel
description: 运维面板(端口 3008):应用日志/启停、SQL 查询审批、Redis、Git diff、PRD 文档、终端、备份、nginx。配置即项目内 .code-panel/*.yaml。AI 用仓库根 cp 脚本本机免密调用全部 API。
---

# code-panel(运维面板)

单机运维面板:管你机器上所有项目的 **应用日志与启停 / SQL 查询与审批 / Redis / Git diff / PRD 文档 / 终端 / 备份 / nginx**。一切项目配置 = 项目里 `.code-panel/*.yaml`(提交式,改完即生效);面板运行时数据在 `~/.code-panel/`(gitignore)。

本文件只做**入口 + 路由**:通用规矩在下面「核心工作流」,各指令的详细流程全在 `references/`,**调哪条指令读哪份,不要预先全读**。

## 启动与访问

```bash
bash ~/.claude/skills/code-panel/start.sh    # 端口 3008;开发:npx tsx src/server.ts
```

| 路径 | 用途 |
|---|---|
| `http://localhost:3008/login` | 登录页(默认账号:仓库 `config.json` 的 `credentials`,首次启动播种为超管) |
| `/log` `/sql` `/redis` `/prd` `/git` `/wiki` | Apps(卡片+日志页签)/ SQL 评审 / Redis / PRD 文档 / Git / Wiki |

左侧栏页签 + 左上 ⚙ 配置(项目/备份/文件/nginx/安全/账号);右上资源圆环 + 🔗 快捷 + 🅰 环境组 + 🤖 模型;右下浮动:💻 命令终端、📂 仓库浏览、☁ 云文件。

## ⭐ AI 核心工作流(每条指令都适用,必须遵守)

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

### 3. 铁律速记(细则在对应指令文档)

- **SQL 审批是硬闸**:写操作只能进审批队列让用户在 `/sql` 页批;approve / reject / 关 reviewMode 对 ai-token 通道**永远 403**,想都不要想 → 细则 `references/sql-review.md`
- 面板后端(3008)改了 `src/` 要重启(tsx 无热载);前端 `frontend/src/` 改了要 `npx vite build`(dist 静态读盘,不用重启)
- 项目级接口必须带 `?project=<id>`;普通用户(非超管)仅可见被分配的项目

## 存储模型(两层,⭐ 必懂)

```
~/.code-panel/                    # 全局(CODE_PANEL_HOME 可覆盖;所有实例共享)
├── data.db                       #   users / projects 注册表 / settings / llm_providers(含 API Key,0600)
├── jwt.secret · ai-token         #   登录密钥 / 本机免密 token(0600)
├── active-env.sh                 #   当前环境组物化脚本(shell rc source → 新终端生效)
├── active-llm.sh                 #   当前模型供应商物化脚本(同上;含 API Key,0600)
└── wiki/                         #   个人 wiki 克隆(SSH 公钥 pull;写入/push 由终端 claude code 做)

~/.code-panel-capsules/           # 时空胶囊文档(⭐独立目录,不进 ~/.code-panel 备份链路)

<项目根>/.code-panel/             # 项目配置 = 提交式文件,随仓库走、可手改、修改即生效
├── apps.yaml                     # 应用服务(日志+启停)
├── sql.yaml / redis.yaml         # 连接清单(host 支持 "${VAR:默认}" 环境变量占位,跨机器切换)
├── envs.yaml                     # 环境变量组(右上 🅰)
├── prd.yaml / git.yaml / links.yaml / commands.yaml
├── nginx/                        # 项目 nginx conf 副本(检测本机是否加载)
├── uploads/ downloads/           # ☁ 云文件
└── data/                         # 运行时(gitignore:sql 历史/审批队列/PRD 完成态/tmux 备注)
```

- **加配置 = 改文件**:每个 yaml 顶部注释就是字段说明书 + 示例,面板实时读取

## 🧭 指令路由表(按需加载,调哪条读哪份)

| 用户说 / 场景 | 指令文档 |
|---|---|
| 「时空胶囊 / 记个想法 / 胶囊」 | [references/capsule.md](references/capsule.md)(流程 + 格式规范) |
| 「/code-panel 归入wiki <分类>:<名字>」 | [references/wiki-merge.md](references/wiki-merge.md)(草稿确认铁律) |
| 「PRD / 写PRD / 原型 / 方案文档」 | [references/prd.md](references/prd.md) + [references/prd-directory-format.md](references/prd-directory-format.md) + `templates/prd/` |
| 「模型切换 / 换模型 / LLM 供应商」 | [references/llm-providers.md](references/llm-providers.md) |
| 「claude-glm / claude-ds / 命令行临时用某模型跑 claude」 | [references/claude-llm-cli.md](references/claude-llm-cli.md)(⚠ 会话内禁碰全局激活) |
| 环境变量组 / 跨机器配置 | [references/env-groups.md](references/env-groups.md) |
| SQL 查询 / 审批 / 写库 | [references/sql-review.md](references/sql-review.md) |
| 给用户交付产物 / 收文件 | [references/cloud-files.md](references/cloud-files.md) |
| 写 / 改 apps.yaml(应用启停) | [references/apps-lifecycle.md](references/apps-lifecycle.md)(**AI 写 apps.yaml 前必读**) |
| 账号 / 授权 / 安全模式 / ai-token 细节 | [references/accounts-security.md](references/accounts-security.md) |
| 某个 API 的参数细节 | [references/api-reference.md](references/api-reference.md)(全部 API 按模块速查) |
