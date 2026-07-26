# read-log v3

日志查看 + 数据库 SQL 执行面板，同一端口 3088。前端使用 Vue 3 + Pinia + Vue Router。

触发词：查看日志、看日志、追踪日志、tail 日志、查数据库、执行 SQL、数据库查询、配置数据库、添加日志

---

## 启动

```bash
bash ~/.claude/skills/read-log/read-log.sh
```

## 面板

| 路径 | 用途 |
|------|------|
| `http://localhost:3088/log` | 日志查看器（实时追踪 + 分组管理） |
| `http://localhost:3088/sql` | SQL 评审面板（审批/拒绝 + DB 状态） |

---

## API 清单

### 数据库连接管理

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/db` | — | `[{id, name, type, version, host?, port?, user?, database?, path?, notes?, hasPassword, alive, lastCheck, serverVersion, healthError}]` |
| **POST** | `/api/db` | `{id, name, type, version, host?, port?, user?, password?, database?, path?, notes?}` | `{ok:true}` |
| **PUT** | `/api/db/:id` | 部分字段 | `{ok:true}` |
| **DELETE** | `/api/db/:id` | — | `{ok:true}` |
| **POST** | `/api/db/test` | `{type, host?, port?, user?, password?, database?, path?}` | `{ok:bool, serverVersion?, error?}` |
| **POST** | `/api/db/refresh` | — | `{ok:true, elapsed, databases:[{id,name,alive,serverVersion,healthError,lastCheck}]}` |

### SQL 执行

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **POST** | `/api/sql/query` | `{sql, dbId}` | `{ok:true, rows, executionTime}` |
| **POST** | `/api/sql/submit` | `{sql, reason, dbId}` | `{ok:true, id, status, mode}` — status=`"pending"`(待审批) 或 `"executed"`(静默模式已执行) |
| **GET** | `/api/sql/status/:id` | — | `{id, status, sql, reason, dbId, submittedAt, reviewedAt?, rejectReason?, result?, error?}` — status: `pending` / `executed` / `rejected` / `failed` |
| **GET** | `/api/sql/review-mode` | — | `{reviewMode:bool}` |
| **POST** | `/api/sql/review-mode` | `{enabled:bool}` | `{ok:true, reviewMode:bool}` |

### SQL 评审（前端审批面板用）

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/sql/queue` | `?status=pending`（可选） | `{ok:true, jobs, reviewMode}` |
| **POST** | `/api/sql/approve/:id` | — | `{ok:true, id, status:"executed", result}` |
| **POST** | `/api/sql/reject/:id` | `{reason?}` | `{ok:true, id, status:"rejected"}` |

### 日志分组配置

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/log-config` | — | `[{key, name, logs:[{id, name, file}]}]` |
| **POST** | `/api/log-config` | `{key, name, logs?:[{name,file}]}` | `{ok:true}` |
| **PUT** | `/api/log-config/:key` | `{name}` | `{ok:true}` |
| **DELETE** | `/api/log-config/:key` | — | `{ok:true}`（级联删除所有条目） |
| **POST** | `/api/log-config/:key/logs` | `{name, file}` | `{ok:true, id}` |
| **PUT** | `/api/log-config/:key/logs/:id` | `{name?, file?}` | `{ok:true}` |
| **DELETE** | `/api/log-config/:key/logs/:id` | — | `{ok:true}` |

### 日志查看

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/logs` | — | `[{name, file, groupKey, groupName, exists, size, active}]`（按活跃度排序） |
| **GET** | `/api/log/content` | `?file=<path>` | `{content, size}` |
| **GET** | `/api/stream` | — | SSE 流，实时推送日志变更 |

### 全局配置

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| **GET** | `/api/config` | — | `{groups, databases, reviewMode}` |
| **PUT** | `/api/config` | 完整 config 对象 | `{ok:true}` |

---

## AI 使用模式

### 查数据（SELECT）

```bash
curl -s -X POST http://localhost:3088/api/sql/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT * FROM users LIMIT 10", "dbId":"mydb"}'
```

### 写数据（有审批）

```bash
# 提交 → 告诉用户去 /sql 审批 → 轮询
curl -s -X POST http://localhost:3088/api/sql/submit \
  -H 'Content-Type: application/json' \
  -d '{"sql":"UPDATE users SET status=1", "reason":"用户申请解封", "dbId":"mydb"}'

curl -s http://localhost:3088/api/sql/status/<id>
```

### 写数据（静默，无需审批）

```bash
curl -s -X POST http://localhost:3088/api/sql/review-mode -H 'Content-Type: application/json' -d '{"enabled":false}'
# ... 执行写操作 ...
curl -s -X POST http://localhost:3088/api/sql/review-mode -H 'Content-Type: application/json' -d '{"enabled":true}'
```

### 管理数据库连接

```bash
curl -s http://localhost:3088/api/db                          # 列表
curl -s -X POST http://localhost:3088/api/db -H ... -d '{...}'  # 新增
curl -s -X PUT http://localhost:3088/api/db/:id -H ... -d '{...}'  # 修改
curl -s -X DELETE http://localhost:3088/api/db/:id              # 删除
curl -s -X POST http://localhost:3088/api/db/refresh            # 刷新存活状态
```

### 管理日志分组

```bash
curl -s http://localhost:3088/api/log-config                              # 列表
curl -s -X POST http://localhost:3088/api/log-config -H ... -d '{...}'     # 新增分组
curl -s -X PUT http://localhost:3088/api/log-config/:key -H ... -d '{...}' # 改名
curl -s -X DELETE http://localhost:3088/api/log-config/:key                # 删除分组
curl -s -X POST http://localhost:3088/api/log-config/:key/logs -H ... -d '{...}'  # 加日志文件
curl -s -X PUT http://localhost:3088/api/log-config/:key/logs/:id -H ... -d '{...}'  # 改日志
curl -s -X DELETE http://localhost:3088/api/log-config/:key/logs/:id        # 删日志
```

### 决策流程

```
SELECT → POST /api/sql/query → 直接返回
写操作 → POST /api/sql/submit →
  ├─ 用户在线 → 告诉用户去 /sql 审批 → 轮询 /api/sql/status/:id
  └─ 静默模式 → 关 reviewMode → 直接执行 → 恢复
配 DB  → POST/PUT/DELETE /api/db → 即时生效
配日志 → POST/PUT/DELETE /api/log-config → 即时生效
```

---

## 实现细节

### 存储

数据库连接 + 日志分组均存储在 SQLite（`data/db-config.sqlite`）。
首次启动自动从 `config.json` 迁移，之后 `config.json` 仅保留 `reviewMode`。

### 健康检查

启动时检查一次，之后每 60 秒自动检查。`/api/db` 响应含 `alive` / `lastCheck` / `serverVersion`。
前端面板显示 ● alive / ○ dead / ◌ unknown。

### config.json

```json
{ "reviewMode": true }
```
