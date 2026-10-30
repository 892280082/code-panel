# 04 · SQL:查询 / 审批 / 历史

> 负责:多数据库连接、SELECT 直查、写操作进审批队列、人工审批后执行、历史记录、连接健康巡检。
> 关键文件:`src/db/connector.ts`、`src/db/health-check.ts`、`src/routes/databases.ts`、`src/routes/sql-exec.ts`、`sql-review.ts`、`sql-history.ts`、`frontend/src/views/SqlView.vue`、`stores/sql.ts`。

## 1. 配置:`sql.yaml`

```yaml
connections:
  - { id: main-db, name: 主库, type: mysql,
      host: ${DB_HOST:127.0.0.1}, port: 3306,   # 支持 ${VAR:默认} 插值(环境组)
      user: root, password: "***", database: app }
  - { id: local-sqlite, name: 本地库, type: sqlite, path: data/app.db }
```

- `type: mysql | sqlite`;sqlite 的 `path` **相对项目根**
- 密码支持环境变量占位,配合 [11-ops-modules.md](11-ops-modules.md) 的环境组做跨机器零改配置
- 读写入口:`GET/PUT /api/projects/:id/yaml/sql` 或直接改文件

## 2. 连接器

`src/db/connector.ts`:

- mysql → `mysql2/promise` 连接池
- sqlite → `sql.js`(WASM;整库载入内存,写回文件)
- 统一暴露 `query(connection, sql, params)`、`test(connection)`
- 连接对象按需创建 + 空闲回收;`health-check.ts` 定时探活

> **sql.js 特殊点**:WASM 加载失败时进程会崩;sqlite 写操作后要显式落盘。历史/队列数据也走 sql.js 全局库,注意不要并发写同一文件。

## 3. 两条执行路径

| 路径 | 是否受 reviewMode 限制 |
|---|---|
| `POST /api/sql/query`(SELECT) | 否,直查 |
| `POST /api/sql/submit`(写操作) | **是**:reviewMode ON → 进队列,等人工审批;OFF → 直接执行 |

判定 SQL 类型用 `sql-exec.ts` 里的解析(按首个关键字),**不要用简单正则**去猜多语句。

### 审批链路

```
AI / 用户 → POST /api/sql/submit {dbId,sql}
          → 队列(sql-queue.json 或 data/)+ 页面响铃
人工在 /sql 页 → POST /api/sql/approve/:id {token}
          → 后端执行 → 写历史 → 通知前端
拒绝 → POST /api/sql/reject/:id
```

- `approve/reject/review-mode` 三个端点有 `denyAi`:本机 ai-token 通道 403,**必须人肉操作**
- 审批 body 需要 `REVIEW_TOKEN`(前端从登录态派生),防止 CSRF
- 队列与历史持久化在项目 `.code-panel/data/`(gitignore)

## 4. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/db?project=` | 连接列表(存活/版本) |
| POST/PUT/DELETE | `/api/db` `/api/db/:id` | 增改删连接(写回 sql.yaml) |
| POST | `/api/db/test` | 内联参数直连测试 |
| POST | `/api/sql/query` | SELECT `{dbId,sql}` |
| POST | `/api/sql/submit` | 写操作提交(reviewMode 下进队列) |
| GET | `/api/sql/history` `/api/sql/queue` | 历史 / 待审批 |
| POST | `/api/sql/approve/:id` `/api/sql/reject/:id` | ⛔ 人肉(ai-token 403) |
| GET/POST | `/api/sql/review-mode` | ⛔ 人肉(开关评审模式) |
| GET | `/api/sql/status/:id` | 某条提交的状态 |

## 5. 前端

| 组件 | 职责 |
|---|---|
| `views/SqlView.vue` | 左侧连接/库表树,右侧编辑器 + 结果表 + 审批队列 |
| `stores/sql.ts` | 连接、当前 SQL、结果、队列轮询、响铃 |
| `components/DbHealthList.vue` | 连接健康列表 |
| `components/HistoryPanel.vue` | 历史记录 |
| `components/RejectModal.vue` | 拒绝理由 |

结果表格要限制渲染行数(默认 200),大结果分页/虚拟滚动。

## 6. 扩展指南

### 加一种数据库(例如 PostgreSQL)

1. `src/db/connector.ts` 加分支:
   ```ts
   if (conn.type === 'pgsql') { const pg = await import('pg'); ... }
   ```
2. `src/projects/yaml.ts` 的 `SqlConnection` 类型加 `'pgsql'` 与字段
3. 前端连接表单加类型选项 + 对应字段
4. `health-check.ts` 的探活语句按类型区分(`SELECT 1` 通用)
5. 文档里补一句支持范围

### 加"SQL 预检/格式化"

- 在 `sql-exec.ts` 里加纯函数(不碰连接),`submit` 前调用
- 前端编辑器加按钮,调一个新端点预览

### 改审批规则(例如 UPDATE 必须带 WHERE)

- 在 `sql-review.ts` 的提交入口做校验,返回 `{ok:false,error}` 并给出行号
- **不要在审批端做**,否则队列里会积累非法语句

## 7. 常见坑

- **reviewMode 是全局设置**(`settings.reviewMode`),不是项目级
- **AI 不能审批**:任何"AI 自己跑完写库"的思路都要走 submit 等人批
- **sqlite 相对路径**容易写错:相对项目根,不是相对面板目录
- **大结果集**会把浏览器卡死:必须限制行数/分页
- 写操作完成后记得刷新历史与队列(前端轮询/SSE)

## 8. 相关速查

- 评审铁律:`references/sql-review.md`
- 接口清单:`references/api-reference.md` 的「数据库 / SQL」节
