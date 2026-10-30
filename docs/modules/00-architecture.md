# 00 · 项目骨架:一次请求怎么走

> 读完这一篇,你应该能回答:请求进了哪个中间件、`project` 参数怎么变成项目目录、为什么所有接口都是 `{ok, ...}`、新模块该挂在哪一层。

## 1. 目录结构

```
code-panel/
├── src/
│   ├── server.ts            # 入口:中间件装配 + 路由挂载 + 启动任务
│   ├── routes/              # 每个模块一个 Router(URL 与参数校验)
│   ├── <module>/            # 领域逻辑:auth/ projects/ terminal/ git/ prd/ ...
│   ├── db/                  # 全局库(sql.js)+ 连接器 + settings/users/projects
│   ├── utils/               # route() 包装、exec、SSE 客户端、安全路径…
│   ├── log-monitor.ts       # 日志监控(SSE 数据源)
│   ├── paths.ts             # 全局路径解析(~/.code-panel、项目根)
│   └── config-manager.ts    # 旧 config.json 兼容层(读)
├── frontend/src/
│   ├── main.ts / App.vue / router.ts / style.css
│   ├── views/               # 7 个页面:Log/Sql/Redis/Prd/Git/Wiki/Login
│   ├── stores/              # Pinia:auth/projects/logs/sql/redis/git/terminal/...
│   ├── components/          # 面板、抽屉、弹窗、侧栏、资源圆环…
│   └── utils/api-fetch.ts   # 统一 fetch(自动带 JWT、统一错误)
├── public/                  # 旧静态资源(字体等)
├── templates/prd/           # PRD 目录模板(复制即用)
└── references/              # 给 AI/开发者的模块速查(API、部署、审批评审…)
```

## 2. 中间件顺序(决定一切)

`src/server.ts` 的顺序**不能乱**:

```ts
app.use(stealthMiddleware);        // ① 安全模式:未解锁一律 404(必须先于 static/json)
app.use(express.json({limit}));    // ② body 解析
app.use(faviconRouter);            // ③ 动态 favicon(先于 static,盖过 dist 里的)
app.use(express.static(DIST_DIR)); // ④ 前端产物
app.use(express.static(PUBLIC_DIR));
app.use(authRouter);               // ⑤ 公开登录口 POST /api/auth/login
app.use(authMiddleware);           // ⑥ 其余 /api/* 一律 JWT(或 ai-token/cookie/query token)
app.use(protectedAuthRouter);      // ⑦ 登出/改密
app.use(terminalProxyMiddleware);  // ⑧ 终端 HTTP 代理(按端口转发 ttyd)
app.use(logsRouter); app.use(sqlRouter); … // ⑨ 各模块
```

**含义**:新模块的路由挂在 ⑨,自动获得登录保护;如果某个接口要公开(比如登录、favicon),必须挂在 authMiddleware **之前**。

## 3. 统一信封与 `route()` 包装

所有 handler 用 `src/utils/route-utils.ts` 的 `route()` 包一层:

```ts
import { route, errorMessage } from '../utils/route-utils';

router.get('/api/xxx', requireProject, route(async (req, res) => {
  const data = await doSomething();
  res.json({ ok: true, data });          // 成功
}));
// 抛错(含 async reject)→ 自动 500 { ok:false, error:"人话" }
```

前端 `apiFetch/apiJson`(`frontend/src/utils/api-fetch.ts`)负责:带上 `Authorization: Bearer <JWT>`、解析信封、失败抛 `errText(e)`。

## 4. 权限三件套

| 中间件 | 位置 | 作用 |
|---|---|---|
| `authMiddleware` | `src/auth/jwt.ts` | 校验 Bearer / `?token=` / `cp_auth` cookie;把 `{username, role, via}` 挂到 req |
| `requireSuperadmin` | `src/auth/jwt.ts` | 仅超管(账号管理、项目增删、模型供应商…) |
| `requireProject` | `src/projects/context.ts` | 解析项目参数 → 校验可见性 → 挂 `reqProject`(含 root、yaml 读写) |
| `denyAi` | `src/routes/sql-review.ts` | 拦截本机 ai-token 通道(SQL 审批/评审模式只许人操作) |

**本机免密通道**:面板启动时生成 `~/.code-panel/ai-token`(0600)。持有它的进程(仓库根 `cp` 脚本)视为本机主人 = 超管,直通全部 API(安全模式也直通),但 `denyAi` 端点一律 403。

## 5. 项目参数怎么变成项目目录

```ts
// src/projects/context.ts
requireProject(req, res, next) {
  const id = req.query.project ?? req.header('X-Project-Id') ?? req.body?.project;
  const project = getProject(id);          // 全局库 projects 表
  if (!visibleTo(req.user, project)) return 403;
  req.project = project;                   // { id, name, root, note }
  req.projectRoot = project.root;          // 例如 /home/you/repository/xxx
  next();
}
```

之后模块里读配置就统一走项目根:

```ts
const yamlPath = path.join(req.projectRoot, '.code-panel', 'sql.yaml');
```

**相对路径约定**:`sql.yaml` 的 sqlite `path`、`apps.yaml` 的 `file` 都**相对项目根**,由面板补绝对路径。

## 6. 存储三层

| 层 | 位置 | 存什么 | 谁改 |
|---|---|---|---|
| 全局库 | `~/.code-panel/data.db`(sql.js) | users、projects、settings、llm_providers | 面板 API(账号/项目/配置) |
| 项目配置 | `<项目根>/.code-panel/*.yaml` | apps/sql/redis/git/prd/commands/links/envs | **人改或 API 改都可以,改完即生效**;随仓库提交 |
| 运行时 | `.code-panel/data/`、`uploads/`、`downloads/` | SQL 历史/队列、PRD 完成态、上传下载 | 面板自己写(gitignore) |

读取全局设置的写法:

```ts
import { getSetting, setSetting } from '../db/global-store';
const reviewMode = getSetting<boolean>('reviewMode', true);
setSetting('reviewMode', false);
```

> ⚠ `data.db` 是 sql.js(整库载入内存,定期落盘)。**不要在外部直接改这个文件**,一定走 API,否则内存态会覆盖你的修改。

## 7. 一个最小模块长什么样

以"快捷方式(links)"为例,四层齐全:

| 层 | 文件 | 内容 |
|---|---|---|
| 领域 | `src/launch/launch-store.ts` | 读写 `links.yaml`、排序、校验 |
| 路由 | `src/routes/launch.ts` | `GET/POST/PUT/DELETE /api/launch/links`,全部 `requireProject + route()` |
| 配置 | `src/projects/yaml.ts` | `links.yaml` 的类型 + 默认骨架 + 注释模板 |
| 界面 | `frontend/src/views/LogView.vue` 顶栏 `🔗` + `QuickLinks.vue` | 调 `/api/launch/links` 展示/跳转 |

## 8. 启动时还会做什么

`server.ts` 末尾的启动任务(新模块若需要长期后台工作,参考这里):

- `initGlobalStore()` —— 载入 sql.js 全局库
- `startTTYD()` / `restoreTmuxSessions()` —— 终端端口池与 tmux 恢复
- `startMonitor()` —— 日志监控(SSE 数据源)
- `startHealthCheck()` —— 数据库连接巡检
- `startCapsuleMonitor()` —— 胶囊目录监听
- `runBackup()` —— 按计划备份
- `ensureAiToken()` —— 生成/校验本机免密 token

**新增常驻任务**时:写一个 `startXxx()` 导出函数,在这里调用;注意幂等(重复调用不重复起定时器),并在 `unref()` 的定时器上不阻塞进程退出。

## 9. 端口一览

| 端口 | 用途 |
|---|---|
| 3008 | 面板 HTTP(前端 + API) |
| 9001 | FAB 浮动终端(ttyd,持久) |
| 9002-9011 | 命令终端池(ttyd,页面级生命周期) |
| 9020-9029 | tmux 接入端口池(ttyd attach) |

端口池被占满时的报错与回收逻辑见 [09-terminal.md](09-terminal.md)。
