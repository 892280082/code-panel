# 模块文档 · 总索引

> 这份文档面向**想要扩展 code-panel 的开发者**:每个模块怎么分层、数据从哪来、接口长什么样、照着怎么加一个自己的模块。
> 单篇只讲一个模块;想新增模块请直接看 [13-how-to-add-a-module.md](13-how-to-add-a-module.md)。

## 一、项目全貌

code-panel 是一个**单机多项目运维面板**:一个 Node 进程 + 一份 Vue SPA,管你机器上所有项目的日志、数据库、Redis、Git、PRD、终端和备份。

```
浏览器 (Vue 3 SPA, /log /sql /redis /prd /git /wiki)
   │  HTTP/SSE/WebSocket (JWT)
   ▼
Express 5 (src/server.ts, 端口 3008)
   ├─ 安全模式(stealth)→ 静态资源 → 登录 → JWT → 项目上下文
   ├─ 路由层 src/routes/*.ts        ← 每个模块一个 Router
   ├─ 领域层 src/<module>/*.ts      ← 业务逻辑(连接/解析/渲染/进程)
   └─ 存储层
        ├─ 全局库 ~/.code-panel/data.db (sql.js: users / projects / settings / llm)
        └─ 项目配置 <项目根>/.code-panel/*.yaml (随仓库提交,改完即生效)
```

**两条硬约定**(所有模块都遵守):

1. **接口信封**:成功 `{ ok: true, data?: ... }`,失败 `{ ok: false, error: "人话" }`;
   项目级接口必须带项目 —— `?project=<id>` / `X-Project-Id` 头 / body 里 `project`。
2. **配置即文件**:模块的项目级配置都放 `.code-panel/<module>.yaml`,**改文件即生效**,不做数据库迁移。

## 二、模块索引

| # | 模块 | 后端 | 前端 | 项目配置 | 文档 |
|---|------|------|------|----------|------|
| 0 | 项目骨架(请求链路/信封/权限) | `src/server.ts` `src/utils/route-utils.ts` `src/projects/context.ts` | — | — | [00-architecture.md](00-architecture.md) |
| 1 | 认证 · 账号 · 安全模式 | `src/auth/*` `src/routes/auth.ts` `users.ts` `src/security/stealth.ts` | `LoginView` `AccountPanel` `SecurityPanel` | 全局 settings | [01-auth-security.md](01-auth-security.md) |
| 2 | 项目注册 · 模块 YAML | `src/projects/*` `src/db/global-store.ts` `src/routes/projects.ts` | `ProjectSwitcher` `ProjectPanel` `GlobalConfigModal` | 全局库 + `.code-panel/*.yaml` | [02-projects-config.md](02-projects-config.md) |
| 3 | 应用日志 · 启停 | `src/log-monitor.ts` `src/routes/logs.ts` | `LogView` `LogTabsPane` `LogPlatformCard` | `apps.yaml` | [03-logs-apps.md](03-logs-apps.md) |
| 4 | SQL 查询 · 审批 | `src/db/connector.ts` `src/routes/sql-*.ts` | `SqlView` | `sql.yaml` | [04-sql-review.md](04-sql-review.md) |
| 5 | Redis | `src/redis/redis-ops.ts` `src/routes/redis.ts` | `RedisView` | `redis.yaml` | [05-redis.md](05-redis.md) |
| 6 | Git · 仓库浏览 | `src/git/*` `src/routes/git-repos.ts` `repo-browser.ts` | `GitView` `RepoBrowserModal` | `git.yaml` | [06-git.md](06-git.md) |
| 7 | PRD 文档 · 原型 | `src/prd/*` `src/routes/prd.ts` | `PrdView` | `prd.yaml` + `.code-panel/prd/` | [07-prd.md](07-prd.md) |
| 8 | Wiki · 时空胶囊 | `src/capsule/*` `src/routes/wiki.ts` `capsule.ts` | `WikiView` `CapsuleEntry` `CapsuleToast` | 全局 settings | [08-wiki-capsule.md](08-wiki-capsule.md) |
| 9 | 终端(ttyd/tmux/命令) | `src/terminal/*` `src/routes/terminal.ts` `tmux.ts` | `CommandDrawer` `TerminalPanel` `TmuxSessionsTab` | `commands.yaml` | [09-terminal.md](09-terminal.md) |
| 10 | 文件/云上传下载 | `src/routes/files.ts` | `CloudPanel` | `.code-panel/uploads|downloads` | [10-files-cloud.md](10-files-cloud.md) |
| 11 | 环境组 · 模型 · nginx · 备份 | `src/env/*` `src/llm/*` `src/nginx/*` `src/backup/*` | `EnvSwitcher` `LlmPanel` `NginxPanel` `BackupPanel` | `envs.yaml` + 全局库 | [11-ops-modules.md](11-ops-modules.md) |
| 12 | 前端骨架(路由/Store/组件) | — | `App.vue` `router.ts` `stores/*` | — | [12-frontend-shell.md](12-frontend-shell.md) |
| 13 | **新增一个模块(完整清单)** | — | — | — | [13-how-to-add-a-module.md](13-how-to-add-a-module.md) |

## 三、建议阅读顺序

1. 先读 [00-architecture.md](00-architecture.md) —— 弄清一次请求怎么走、信封/权限/项目参数怎么用
2. 再读你想仿写的那个模块(比如想加"收藏夹"就参考 03/06 这种"yaml + 路由 + 视图"的写法)
3. 最后照着 [13-how-to-add-a-module.md](13-how-to-add-a-module.md) 的清单落地

## 四、本地跑起来

```bash
cd code-panel
npm install                 # 后端依赖
cd frontend && npm install && cd ..
npm start                   # = tsx src/server.ts,端口 3008
# 首次启动按 config.json 的 credentials 播种超管账号
cd frontend && npm run build   # 前端产物 → frontend/dist(express 直接静态托管)
```

开发前端热更新用 `cd frontend && npm run dev`(Vite 代理到 3008,配置见 `frontend/vite.config.ts`)。

## 五、模块的"四件套"

一个模块通常由四部分组成,新增时缺一不可:

| 层 | 位置 | 职责 |
|---|---|---|
| 路由 | `src/routes/<module>.ts` | 定义 URL、权限、参数校验;`server.ts` 里 `app.use(...)` 挂载 |
| 领域 | `src/<module>/*.ts` | 真正干活的代码(连库、读文件、跑进程、渲染) |
| 配置 | `<项目根>/.code-panel/<module>.yaml` | 模块的项目级数据;`src/projects/yaml.ts` 定义类型与默认骨架 |
| 界面 | `frontend/src/views/<X>View.vue` + `stores/<x>.ts` | 页面 + 状态;`router.ts` 注册路由,`Sidebar.vue` 加入口 |

> 细节、代码片段和踩坑清单见 [13-how-to-add-a-module.md](13-how-to-add-a-module.md)。
