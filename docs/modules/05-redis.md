# 05 · Redis:连接 / 浏览 / 清理

> 负责:项目内 Redis 连接管理、INFO 概览、SCAN 键浏览、键详情解码、TTL 修改、删键、清库(带审批)。
> 关键文件:`src/redis/redis-ops.ts`、`src/routes/redis.ts`、`frontend/src/views/RedisView.vue`、`stores/redis.ts`。

## 1. 配置:`redis.yaml`

```yaml
connections:
  - { id: cache, name: 主缓存, host: "${REDIS_HOST:127.0.0.1}", port: 6379, password: "", db: 0 }
```

- `host` 支持 `${VAR:默认}` 插值(环境组),见 [11-ops-modules.md](11-ops-modules.md)
- 增删改接口写回 `redis.yaml`:`POST/PUT/DELETE /api/redis[/:id]`

## 2. 领域层 `redis-ops.ts`

- 用 `ioredis` 建连接(按连接 id 缓存,失败重连)
- 封装:
  - `info(conn, db)` → 内存/命中率/客户端/keyspace
  - `scanKeys(conn, db, cursor, match, count)` → 游标分页(**禁止 KEYS \***)
  - `getKey(conn, db, key)` → 按类型解码(string/hash/list/set/zset/stream),JSON 自动解析
  - `setTtl / delKey / batchDelete / flush`
- 所有返回都把 `password` 脱敏(`****尾4`)

## 3. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/redis?project=` | 连接列表(存活/版本/脱敏) |
| POST/PUT/DELETE | `/api/redis` `/api/redis/:id` | 增改删连接 |
| GET | `/api/redis/:id/info?project=&db=` | INFO 概览 |
| GET | `/api/redis/:id/keys?project=&db=&cursor=&match=&count=` | SCAN 分页 |
| GET | `/api/redis/:id/key?project=&db=&key=` | 键详情(各类型解码) |
| POST | `/api/redis/:id/ttl` | 改 TTL `{db,key,ttl}` |
| DELETE | `/api/redis/:id/key` | 删单键 `{db,key}` |
| POST | `/api/redis/:id/keys/delete` | 批量删 `{db,keys≤500}` 或 `{db,match}`(**match 走审批**) |
| POST | `/api/redis/:id/flushdb` `flushall` | 清库(需 confirm 文本;reviewMode 下进队列) |
| GET | `/api/redis/:id/history` | 操作历史(50 条) |

> 破坏性操作(按模式批量删、清库)**必须**接入 SQL 审批队列(同一个 reviewMode),不要直接执行。

## 4. 前端

| 组件 | 职责 |
|---|---|
| `views/RedisView.vue` | 左侧连接 + DB 选择 + 键搜索;右侧键详情编辑 |
| `stores/redis.ts` | 连接、键列表、游标、详情、历史 |
| `components/DbHealthList.vue` 复用 | 连接健康 |

交互要点:

- 键列表用**游标加载更多**,不要一次拉全量
- 大 hash/list 只显示前 N 条 + "加载更多"
- 清库按钮要做二次确认(输入库名/`FLUSHALL` 文本)

## 5. 扩展指南

### 加一种键类型的可视化(例如 bitfield / geo)

1. `redis-ops.ts` 的 `getKey` 加分支,返回 `{type, value, meta}`
2. 前端详情面板加渲染分支(参考 zset 的表格)
3. 编辑能力(若非只读)必须单独设计接口,**不要通用 `set` 任意类型**

### 加"键名搜索历史/收藏"

- 存项目 `.code-panel/data/redis-favorites.json`(运行时数据,不进 git)
- 或加到全局 settings(跨项目共用)

### 加"实例监控曲线"

- `info` 已有字段,前端定时轮询 + 画 sparkline
- 注意频率(≥5s),避免把小 Redis 打满

## 6. 常见坑

- **SCAN 不是快照**:边删边扫会漏/重,UI 要允许重复
- **不要用 KEYS \***:阻塞单线程 Redis,生产事故
- **密码脱敏**:前端回传 `****` 时后端要"保留旧值",防止把密码写没(参考 LLM 模块的同一处理)
- **清库 = 高危**:必须人肉确认;AI 通道不允许自动清
- **db 索引**:`SELECT db` 后再 scan,游标是 per-db 的

## 7. 相关速查

接口清单:`references/api-reference.md` 的「Redis」节。
