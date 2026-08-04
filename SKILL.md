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

## 📝 数据录入教程（教别人如何录入数据）

面板自己的配置（数据库连接、日志分组、终端命令）都存储在 `data/db-config.sqlite` + `data/terminal-commands.json`。
录入数据有两条路：**① 调 API（推荐，可批量、可被 AI 执行）** ② **前端页面点加号**（人工操作）。下面是 API 方式。

### 当前库里的数据（截至 2026-08-04，可直接模仿）

**数据库连接（3 条，`connections` 表）**

| id | name | type | group | host | port | user | database | path |
|----|------|------|-------|------|------|------|----------|------|
| `zc-main` | zc-main | mysql | proj | db.example.com | 3306 | root | integration_platform | — |
| `zc-exam` | zc-exam | mysql | proj | db.example.com | 3306 | root | integration_exam | — |
| `opencode-platform` | opencode-platform | sqlite | proj | — | — | — | — | /Users/owner/repository/proj-v3/zc-opencode/opencode-platform.db |

**日志分组（2 个）+ 日志条目（9 条）**

| 分组 key | 分组名 | 日志条目（name → file，port） |
|----------|--------|------------------------------|
| `proj` | proj | zc-main → /tmp/zc-main.log (7071)、zc-platform-backend → /tmp/zc-platform-backend.log (6173)、zc-study → /tmp/zc-study.log (6170)、zc-exam → /tmp/zc-exam.log (7072)、ai-opencode-server → /tmp/ai-opencode-server.log (3011)、ai-platform-api → /tmp/ai-platform-api.log (3015)、ai-platform → /tmp/ai-platform.log (3013)、ai-chat → /tmp/ai-chat.log (3014) |
| `test` | 测试 | 测试日志 → /tmp/test-log.log |

**终端命令**：7 条系统预设（`type: system`，只读）+ 自定义命令（`type: custom`），如 `🚀 启动主模块`（group: proj，执行 fast-start 脚本）。

### ① 录入数据库连接

```bash
# MySQL 连接（模仿 zc-main）
curl -s -X POST http://localhost:3008/api/db \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-db",                          # 唯一标识（必填）
    "name": "my-db",                        # 显示名称（必填）
    "type": "mysql",                        # mysql | sqlite（必填）
    "version": "8.0",
    "group": "proj",                        # 所属分组，可空
    "host": "db.example.com",
    "port": 3306,
    "user": "root",
    "password": "xxxx",
    "database": "integration_platform",
    "notes": "备注说明"
  }'

# SQLite 连接（模仿 opencode-platform，无 host/port/user，用 path）
curl -s -X POST http://localhost:3008/api/db \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-sqlite",
    "name": "my-sqlite",
    "type": "sqlite",
    "group": "proj",
    "path": "/absolute/path/to/xxx.db"      # 必须是绝对路径
  }'

# 验证连接是否可用（不用先录入，直接测）
curl -s -X POST http://localhost:3008/api/db/test \
  -H 'Content-Type: application/json' \
  -d '{"type":"mysql","host":"db.example.com","port":3306,"user":"root","password":"xxxx","database":"integration_platform"}'
# → {ok:true, serverVersion:"8.0.36"} 或 {ok:false, error:"..."}
```

### ② 录入日志分组 + 日志条目

```bash
# 一次性创建分组并带日志条目（模仿 test 分组）
curl -s -X POST http://localhost:3008/api/log-config \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "my-group",                      # 分组唯一 key（必填）
    "name": "我的分组",                      # 显示名称（必填）
    "logs": [
      {"name": "日志A", "file": "/tmp/log-a.log"},
      {"name": "日志B", "file": "/tmp/log-b.log"}
    ]
  }'

# 分组已存在时，往分组里加一条日志（模仿 proj 组的 8 条）
curl -s -X POST http://localhost:3008/api/log-config/proj/logs \
  -H 'Content-Type: application/json' \
  -d '{"name": "zc-main", "file": "/tmp/zc-main.log", "port": 7071}'
# → {ok:true, id:9}   # port 用于端口存活检测，不需要就不传

# 改日志条目 / 删日志条目
curl -s -X PUT http://localhost:3008/api/log-config/proj/logs/9 \
  -H 'Content-Type: application/json' -d '{"file": "/tmp/zc-main-new.log"}'
curl -s -X DELETE http://localhost:3008/api/log-config/proj/logs/9
```

> 注意：`file` 必须是服务器上真实存在的日志文件路径，前端 `●` 存活状态靠它判断。

### ③ 录入终端命令（右侧绿色 FAB → 命令抽屉）

```bash
# 自定义命令（模仿「🚀 启动主模块」，关联到 proj 分组）
curl -s -X POST http://localhost:3008/api/terminal/commands \
  -H 'Content-Type: application/json' \
  -d '{
    "label": "🚀 启动主模块",
    "command": "bash /Users/owner/repository/proj-v3/.claude/skills/fast-start/scripts/start.sh zc-main zc-platform-backend zc-study",
    "cwd": "/Users/owner/repository/proj-v3/.claude/skills/fast-start",
    "group": "proj"                         # 空 = 全局可见
  }'
# → {ok:true, data:{id:"...", type:"custom"}}

# 录入完成后用 ?group= 验证
curl -s "http://localhost:3008/api/terminal/commands?group=proj"
```

### 校验录入是否成功

```bash
# 三张总览（前端 /log 和 /sql 页面同源数据）
curl -s http://localhost:3008/api/config        # groups + databases + reviewMode
curl -s http://localhost:3008/api/logs          # 日志列表（含 exists/alive 状态）
curl -s http://localhost:3008/api/db            # 数据库连接（含 alive 健康检查）
```

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
