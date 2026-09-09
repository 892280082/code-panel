# code-panel API 速查(按模块)

> 全部接口返回 `{ok, data|error}` 信封(除特别注明);项目级接口必须带 `?project=<id>`(或 X-Project-Id 头 / body.project)。`project` 传**注册表 id**(数字),不是项目名。
> 认证三选一:① `bash cp get/post/put/delete <path>`(AI 首选,本机免密)② `Authorization: Bearer <JWT>`(登录态)③ `?token=<JWT>` / `cp_auth` cookie(SSE/iframe/下载)。

## 认证 / 账号

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{username,password,remember?}` → `{token,username,role}` + Set-Cookie |
| POST | `/api/auth/logout` | 清 cookie |
| POST | `/api/auth/change-password` | `{oldPassword,newPassword}` |
| GET | `/api/users` | 用户列表(仅超管;含 projectIds) |
| POST/PUT/DELETE | `/api/users` `/api/users/:name` | 建号/重置密码/分配项目/删号(仅超管) |

## 项目注册表 / 模块 YAML

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 项目列表(name/root/note) |
| POST | `/api/projects` | `{name,root,note?}` 注册并生成 `.code-panel/` 骨架 |
| PUT/DELETE | `/api/projects/:id` | 改名/换 root/注销 |
| GET/PUT | `/api/projects/:id/yaml/:module` | 读写模块 YAML(apps/sql/prd/git/commands/links/envs/redis;PUT body `{yaml:{...}}`)—— 等价直接改文件 |

## 巡检(⭐ AI 改完配置自检)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/inspect?project=` | 一发聚合:项目信息 + 当前环境组生效 vars + 各模块条目数/mtime/解析错误 + sql/redis 连接(插值后 host + 存活 + 密码脱敏) + 应用端口探活 + 静态校验 errors |

## Apps / 日志 / 资源

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/logs?project=` | 应用服务清单(platform/side/name/file/port/start/stop + alive/active/size) |
| GET | `/api/log/content?project=&file=` | 读某服务日志(仅限清单内) |
| POST | `/api/log/clear?project=` | 清空日志文件 |
| GET | `/api/stream?project=&token=` | SSE:实时日志 + 端口存活 |
| GET | `/api/resources` | CPU/内存/磁盘 |
| GET | `/api/resources/processes` | 进程 TOP(按内存) |
| GET | `/api/launch/links?project=` | 启动页快捷链接 |

## 数据库 / SQL

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/db?project=` | 连接列表(含存活/版本) |
| POST/PUT/DELETE | `/api/db` `/api/db/:id` | 增改删连接(写回 sql.yaml) |
| POST | `/api/db/test` | 内联参数直连测试 |
| POST | `/api/sql/query` | SELECT 直查 `{dbId,sql}` 或 `connection` 内联 |
| POST | `/api/sql/submit` | 写操作提交审批(reviewMode 下进队列) |
| GET | `/api/sql/history` `/api/sql/queue` | 历史(200)/审批队列 |
| POST | `/api/sql/approve/:id` `reject/:id` | ⛔ 人肉专用(body 需 REVIEW_TOKEN;ai-token 通道 403) |
| GET/POST | `/api/sql/review-mode` | ⛔ 人肉专用(开关评审模式;ai-token 通道 403) |

## Redis

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/redis?project=` | 连接列表(存活/版本/脱敏) |
| POST/PUT/DELETE | `/api/redis` `/api/redis/:id` | 增改删连接(写回 redis.yaml) |
| GET | `/api/redis/:id/info?project=&db=` | INFO 概览(内存/命中率/客户端/keyspace) |
| GET | `/api/redis/:id/keys?project=&db=&cursor=&match=&count=` | SCAN 游标分页(类型/PTTL/大小) |
| GET | `/api/redis/:id/key?project=&db=&key=` | key 详情(各类型解码,JSON 自动解析) |
| POST | `/api/redis/:id/ttl` | 改 TTL `{db,key,ttl}` |
| DELETE | `/api/redis/:id/key` | 删单 key `{db,key}` |
| POST | `/api/redis/:id/keys/delete` | 批量删 `{db,keys≤500}` 或 `{db,match}`(match 走审批) |
| POST | `/api/redis/:id/flushdb` `flushall` | 清库(需 confirm 文本;reviewMode 下进审批队列) |
| GET | `/api/redis/:id/history` | 操作历史(50) |

## Git

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/git/repos` `/api/git/repos/:id` | 仓库 CRUD(写回 git.yaml) |
| GET | `/api/git/summary|diff|log|source/:id?project=` | 状态/diff/历史/源码 |
| POST | `/api/git/pull-all?project=` | 一键同步 |
| GET | `/api/repo-browser/:repoId/tree|file|diff|file-log|commit-diff|git-changes` | 文件树/预览/文件历史(带 ?project) |

## PRD / 快捷方式 / 环境

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/prd/folders?project=` | 目录清单(文件数/完成态) |
| GET | `/api/prd/files|content|view|file|code-file` | 文件列表/内嵌渲染/双栏页/原型直读/伪代码高亮 |
| POST | `/api/prd/done` | `{project,dir,done}` 完成态 |
| GET | `/api/links?project=` | 快捷方式分组 |
| GET | `/api/env?project=` | 环境组列表 + 当前生效 |
| POST | `/api/env/ensure|activate|reset|mount` | 兜底/选用/重置/补挂 shell rc |

## 终端 / 文件 / 备份 / nginx / 全局

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/terminal/commands?project=` | 系统 + 项目自定义命令 |
| POST | `/api/terminal/sessions` | 页面级命令终端(ttyd 9002-9011) |
| GET/DELETE | `/api/terminal/sessions[/:port]` | 列表/关闭 |
| GET | `/api/terminal/tmux/list?project=` | tmux 常驻会话 |
| POST | `/api/terminal/tmux/create|attach` | 新建/接入(9020-9029) |
| DELETE | `/api/terminal/tmux-sessions/:port` `/api/terminal/tmux/:name` | 断接入/彻底删 |
| GET/PUT | `/api/files/config` | 云上传/下载目录 |
| GET | `/api/files?side=upload|download` | 目录清单(新→旧) |
| POST | `/api/files/upload` `paste-image` | 多文件上传 / 剪贴板图 |
| GET | `/api/files/raw?side=&name=` | 读文件(inline,?token= 供下载) |
| GET/PUT | `/api/backup/config` · POST `/api/backup/run` · GET `/api/backup/list` · GET `/api/backup/download/:name` | 备份(全局 settings.backup.path;保留 20 份) |
| GET | `/api/nginx/status|confs|conf` · POST `/api/nginx/check` | 本机 nginx 检测(只读) |
| GET/PUT | `/api/config` | 全局配置(reviewMode/security/jwt/ttyd…) |
