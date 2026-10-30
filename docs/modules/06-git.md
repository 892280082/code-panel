# 06 · Git:仓库 / 变更 / 历史 / 文件浏览

> 负责:项目内多仓库管理、工作区状态、diff、提交历史、一键拉取、仓库文件树浏览。
> 关键文件:`src/git/git-exec.ts`、`git-diff.ts`、`git-log.ts`、`git-pull.ts`、`git-file-service.ts`、`git-repo-store.ts`、`src/routes/git-repos.ts`、`repo-browser.ts`、`frontend/src/views/GitView.vue`、`stores/git.ts`、`stores/repo-browser.ts`、`components/GitLogPanel.vue`、`FileTreeNode.vue`、`DiffOverviewRuler.vue`。

## 1. 配置:`git.yaml`

```yaml
repos:
  - id: main            # 面板路由引用键(/api/git/diff/<id>)
    name: 主仓库
    path: .             # 相对项目根(也可以是子目录)
```

- `id` 是稳定 slug;只有一个仓库时写项目名即可
- API 写回:CRUD `/api/git/repos[/:id]`

## 2. 领域层

| 文件 | 职责 |
|---|---|
| `git-exec.ts` | 统一 `git` 调用封装(超时、错误、路径安全、禁止交互) |
| `git-diff.ts` | 工作区 diff、单文件 diff、统计 |
| `git-log.ts` | 提交历史、单提交文件列表、文件历史 |
| `git-pull.ts` | `pull --ff-only` 一键同步 |
| `git-file-service.ts` | 读仓库文件内容(带大小/二进制判断) |
| `git-repo-store.ts` | `git.yaml` 读写 |

**安全要点**:所有路径参数必须 `safe-resolve` 到仓库根内;分支/远程名做白名单校验,防命令注入。

## 3. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/git/repos` `/api/git/repos/:id` | 仓库 CRUD |
| GET | `/api/git/summary/:id` | 当前分支/领先落后/变更数 |
| GET | `/api/git/diff/:id` | 工作区 diff(可选 `?file=`) |
| GET | `/api/git/log/:id` | 提交历史(分页) |
| GET | `/api/git/source/:id` | 文件源码 |
| POST | `/api/git/pull-all` | 一键拉取(ff-only) |
| GET | `/api/repo-browser/:repoId/tree` | 文件树 |
| GET | `/api/repo-browser/:repoId/file` | 文件内容(带高亮所需语言) |
| GET | `/api/repo-browser/:repoId/diff` | 文件 diff |
| GET | `/api/repo-browser/:repoId/file-log` | 文件历史 |
| GET | `/api/repo-browser/:repoId/file-commit-diff` | 某提交对该文件的 diff |
| GET | `/api/repo-browser/:repoId/commit-files` | 某提交的文件清单 |
| GET | `/api/repo-browser/:repoId/git-changes` | 工作区变更列表 |

## 4. 前端

| 组件 | 职责 |
|---|---|
| `views/GitView.vue` | 仓库选择 + 变更列表 + diff 视图 |
| `stores/git.ts` | 仓库、summary、diff、log |
| `stores/repo-browser.ts` | 文件树/打开文件/历史(全局弹窗) |
| `components/GitLogPanel.vue` | 提交历史(图+详情) |
| `components/FileTreeNode.vue` | 树节点(懒加载) |
| `components/DiffOverviewRuler.vue` | diff 右侧概览条 |
| `components/RepoBrowserModal.vue` | 仓库浏览大弹窗 |

## 5. 扩展指南

### 加"暂存/提交"能力

1. `git-exec.ts` 已有执行封装,新增 `git add / commit` 函数
2. 路由加 `POST /api/git/commit`,参数做校验
3. **权限**:是否允许面板改工作区要明确(默认只读更安全)
4. 前端加表单(提交信息、文件勾选)

### 加"分支切换"

- `git checkout <branch>` 前先检查工作区是否干净(否则拒绝)
- 分支名白名单校验(不允许 `-` 开头的参数注入)

### 加"远程配置查看"

- 只读:`git remote -v`;不要暴露带密码的 URL(脱敏)

## 6. 常见坑

- **禁止交互式 git**:所有命令加 `-c core.pager=cat`、`GIT_TERMINAL_PROMPT=0`,避免卡死
- **pull 用 `--ff-only`**:面板不做 merge 冲突解决
- **大仓库 diff 慢**:限制文件数/大小,前端做懒加载
- **路径穿越**:`safe-resolve` 是硬要求
- **编码**:非 UTF-8 文件要检测并按二进制/转码处理,别把界面搞崩

## 7. 相关速查

接口清单:`references/api-reference.md` 的「Git」节。
