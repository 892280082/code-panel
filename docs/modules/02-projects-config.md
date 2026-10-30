# 02 · 项目注册 · 模块 YAML

> 负责:项目注册表、`.code-panel/` 目录骨架、模块 YAML 的读写与校验、聚合巡检。
> 关键文件:`src/db/global-store.ts`、`src/db/projects.ts`、`src/projects/*`、`src/routes/projects.ts`、`src/routes/inspect.ts`。

## 1. 项目注册表(全局库)

`projects` 表(不是 YAML):

| 字段 | 说明 |
|---|---|
| `id` | 自增整数,API 里的 `?project=<id>` 就是它 |
| `name` | 显示名(侧栏/项目切换器) |
| `root` | 项目根目录(**必须存在**) |
| `note` | 中文备注 |

- `POST /api/projects {name,root,note?}`:**注册时自动创建** `<root>/.code-panel/` 骨架(各 yaml + uploads/downloads/data)
- `PUT/DELETE /api/projects/:id`:改名/换根/注销(**只删注册,不删项目目录**)
- 这些接口**仅超管**

前端:左上项目切换器 `components/ProjectSwitcher.vue`;⚙ →「项目」Tab 为 `components/ProjectPanel.vue`。

## 2. `.code-panel/` 目录约定

```
<项目根>/.code-panel/
├── apps.yaml        # 应用服务(日志 + 启停)        —— 见 03
├── sql.yaml         # 数据库连接                     —— 见 04
├── redis.yaml       # Redis 连接                     —— 见 05
├── git.yaml         # git 仓库列表                   —— 见 06
├── prd.yaml         # PRD 目录与完成态               —— 见 07
├── commands.yaml    # 命令抽屉按钮                   —— 见 09
├── links.yaml       # 快捷方式                       —— 见 00
├── envs.yaml        # 环境变量组                     —— 见 11
├── README.md        # 目录说明(面板自动生成)
├── uploads/         # ☁ 用户上传(gitignore)
├── downloads/       # ☁ 交付产物(gitignore)
└── data/            # 运行时数据(SQL 历史/队列、PRD 完成态…)(gitignore)
```

**设计原则**:

1. **一模块一文件**,yaml 顶部注释就是字段说明;
2. **提交式**:配置随项目仓库走,换机器 checkout 即可用;
3. **改文件即生效**:面板每次读盘,不做内存缓存(或按 mtime 失效);
4. 运行时数据一律进 `data/`,不进 git。

## 3. YAML 类型与默认骨架

`src/projects/yaml.ts` 是唯一事实源:

```ts
export type ProjectModule = 'apps' | 'sql' | 'prd' | 'git' | 'commands' | 'links' | 'redis' | 'envs';
export const DEFAULT_SKELETONS: Record<ProjectModule, string> = {
  apps: `# ── apps.yaml —— 应用服务 …\nplatforms: []`,
  sql:  `# ── sql.yaml —— 数据库连接 …\nconnections: []`,
  // …
};
```

- `GET /api/projects/:id/yaml/:module` → `{ok, data:{yaml: <解析后对象>}}`
- `PUT …/yaml/:module` body `{yaml:{...}}` → 全量写回(**不是补丁**)

> 新增配置模块时,必须在这里加类型 + 默认骨架 + 注释模板,并在 `ensureProjectSkeleton()` 里补文件生成。

## 4. 项目上下文与相对路径

`requireProject`(`src/projects/context.ts`)把 URL/Header/body 里的 project 解析成:

```ts
req.project = { id, name, root, note };
req.projectRoot = project.root;
```

模块里统一:

```ts
const file = path.join(req.projectRoot, '.code-panel', 'sql.yaml');
```

**相对路径规则**(写配置的人最容易踩):

- `apps.yaml` 的 `file:` 相对**项目根**
- `sql.yaml` 的 sqlite `path:` 相对**项目根**
- PRD 里的原型引用相对 md 文件所在目录
- 读用户输入路径时一律用 `src/utils/safe-resolve.ts`,防目录穿越

## 5. 聚合巡检 `/api/inspect`

一面"体检"接口,改完配置自检用:

```
GET /api/inspect?project=<id>
→ {
    project, env(当前环境组生效 vars),
    llm(当前供应商/脱敏),
    modules: { apps: {count, mtime, errors}, sql: {...}, ... },
    db: [插值后 host + 存活 + 密码脱敏], ports: [...], errors: [...]
  }
```

新增模块后,建议在 `src/routes/inspect.ts` 里补一段(条目数 + 解析错误),这样 `/api/inspect` 能覆盖它。

## 6. 扩展指南:新增一个 YAML 模块

以"收藏夹 bookmarks.yaml"为例:

1. `src/projects/yaml.ts`
   - `ProjectModule` 联合类型加 `'bookmarks'`
   - `DEFAULT_SKELETONS.bookmarks` 写带注释的骨架
   - 解析类型 `BookmarksFile = { items: { id, title, url }[] }`
2. `ensureProjectSkeleton()` 里补:注册新项目时生成该文件
3. 领域层 `src/bookmarks/store.ts`:读/写/校验(参考 `launch-store.ts`)
4. 路由 `src/routes/bookmarks.ts`:`requireProject + route()` 的标准四件套
5. `src/server.ts` 挂载 `app.use(bookmarksRouter)`
6. 前端:`stores/bookmarks.ts` + 面板组件;入口放 ⚙ 或对应 View
7. `src/routes/inspect.ts` 加体检项
8. 文档:在本目录补一篇 `xx-bookmarks.md`,并更新 [index.md](index.md) 的模块表

## 7. 常见坑

- **PUT yaml 是全量覆盖**:前端编辑要先把整份读出来再改,别只传增量
- **yaml 语法错误**:面板会在 `/api/inspect` 的 `errors` 里报,不要等运行时才炸
- **root 目录必须存在**:注册时不校验运行期路径,写文件前自行 `fs.existsSync`
- **不要直接改 `data.db`**:sql.js 内存态会覆盖
- **项目可见性**:普通用户访问未分配项目 → 403;新增项目级路由必须挂 `requireProject`
