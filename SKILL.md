---
name: code-panel
description: >-
  日志查看 + 数据库 SQL 执行面板，提供实时日志追踪、SQL 查询/审批、多数据库连接管理。
  用户说"查看日志、看日志、追踪日志、tail 日志、查数据库、执行 SQL、数据库查询、配置数据库、添加日志文件"时触发。
  启动端口 3008。前端 Vue 3 + Pinia + Vue Router。
---

## 启动

```bash
bash ~/.claude/skills/code-panel/start.sh
```

## 访问面板

| 路径 | 用途 |
|------|------|
| `http://localhost:3008/log` | 日志查看器（实时追踪 + 分组管理） |
| `http://localhost:3008/sql` | SQL 评审面板（审批/拒绝 + DB 存活状态 + 查询历史） |

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

管理右上角绿色 FAB 按钮 → 右侧抽屉里的预填写命令。支持**增删改 + 排序 + 分组联动**。

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/terminal/commands` | `?group=xxx`（可选筛选） | `{ok:true, data:[...]}` |
| **POST** | `/api/terminal/commands` | `{label, command, cwd?, group?}` | `{ok:true, data:{id,label,command,cwd?,group?,type:"custom",...}}` |
| **PUT** | `/api/terminal/commands/reorder` | `{ids:[], group?}` | `{ok:true}` |
| **PUT** | `/api/terminal/commands/:id` | `{label?, command?, cwd?, group?}` | `{ok:true, data:{...}}` |
| **DELETE** | `/api/terminal/commands/:id` | — | `{ok:true}` |

**字段说明**：
| 字段 | 类型 | 必填 | 限制 |
|------|------|------|------|
| `label` | string | ✅ | 1-100 字符，按钮显示名称 |
| `command` | string | ✅ | 1-4096 字符，终端中执行的命令 |
| `cwd` | string | 否 | 绝对路径（`/` 开头），命令执行的工作目录 |
| `group` | string | 否 | 所属日志分组 key，为空时全局可见 |

> **分组联动**：当指定 `?group=xxx` 查询时，只返回该分组的自定义命令。系统预设命令（磁盘空间、内存、CPU 等 7 条）全局可见。前端自动跟随当前日志分组切换。

**示例**：
```bash
# 注册一条自定义命令（关联到 production 分组）
curl -s -X POST http://localhost:3008/api/terminal/commands \
  -H 'Content-Type: application/json' \
  -d '{"label":"查看Nginx日志","command":"tail -f /var/log/nginx/access.log","cwd":"/var/log/nginx","group":"production"}'

# 按分组查看命令
curl -s "http://localhost:3008/api/terminal/commands?group=production"

# 编辑命令
curl -s -X PUT http://localhost:3008/api/terminal/commands/<id> \
  -H 'Content-Type: application/json' \
  -d '{"label":"改后名称","command":"echo hello"}'

# 排序（传入自定义命令 ID 数组的新顺序）
curl -s -X PUT http://localhost:3008/api/terminal/commands/reorder \
  -H 'Content-Type: application/json' \
  -d '{"ids":["id1","id2","id3"],"group":"production"}'

# 删除命令
curl -s -X DELETE http://localhost:3008/api/terminal/commands/<id>
```

> `type: "system"` 的命令（磁盘空间、内存、CPU、网络连接、进程列表、系统负载、磁盘 IO）为只读预设，不可编辑删除。API 创建的命令固定为 `type: "custom"`。

### 全局配置

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/config` | — | `{groups, databases, reviewMode}` |
| **PUT** | `/api/config` | 完整 config 对象 | `{ok:true}` |

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
