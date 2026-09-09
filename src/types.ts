// ── Shared types for read-log v2 ──────────────────────────

/** 数据库连接类型 */
export type DbType = 'mysql' | 'sqlite';

/** 数据库连接配置 */
export interface DbConnection {
  id: string;           // 唯一标识
  name: string;         // 显示名称，如 "生产数据库"
  type: DbType;
  version?: string;      // 版本号，如 "8.0" / "3"（缺省为 ''）
  group?: string;       // 旧分组字段——已废弃，仅作历史存档，代码不应再读取
  // MySQL 字段
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  // SQLite 字段
  path?: string;        // SQLite 文件路径
  notes?: string;       // 备注说明
}

/** 内联数据库连接参数（直连用，不查配置） */
export interface DbConnectionParams {
  type: DbType;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  path?: string;        // SQLite 文件路径
}

/** Redis 连接配置(项目 .code-panel/redis.yaml;host 支持 ${VAR:default} 插值) */
export interface RedisConnection {
  id: string;           // 唯一标识(如 hq / school,与 sql.yaml 平台 id 对齐)
  name: string;         // 显示名
  host?: string;        // 默认 127.0.0.1
  port?: number;        // 默认 6379
  password?: string;
  db?: number;          // 默认聚焦的 db 号(方舟按实例分 db 50-58)
  notes?: string;
}

/** 日志条目(来自某项目 logs.yaml,按 section 平铺) */
export interface LogEntry {
  name: string;
  file: string;
  section?: string;       // 所属 logs.yaml section 名
  projectId?: string;     // 所属项目 id(供 SSE 过滤 / 区分来源)
  port?: number;          // 服务端口号，用于存活检测
}

/** 日志分组(历史类型;P2 起项目内用 section,不再有全局 group) */
export interface LogGroup {
  name: string;
  logs: { name: string; file: string; port?: number }[];
}

/** 应用配置(全局设置——不再含 groups/databases,它们已随项目下沉) */
export interface AppConfig {
  reviewMode: boolean;
}

/** SQL 执行任务状态 */
export type SqlJobStatus =
  | 'pending'     // 待审批
  | 'approved'    // 已批准（即将执行）
  | 'rejected'    // 已拒绝
  | 'executed'    // 执行成功
  | 'failed';     // 执行失败

/** 审批任务类型(sql / redis 危险操作共队列) */
export type JobKind = 'sql' | 'redis';

/** Redis 审批载荷(kind=redis 时;approve 后按此执行) */
export interface RedisJobPayload {
  connId: string;         // redis.yaml 连接 id
  db?: number;            // 目标 db(FLUSHDB/删 key 用)
  action: 'flushdb' | 'flushall' | 'delete-keys';
  keys?: string[];        // action=delete-keys 时的 key 清单(≤500)
  match?: string;         // action=delete-keys 的模式删除(与 keys 二选一)
  limit?: number;         // 模式删除上限(默认 2000)
}

/** SQL 执行任务 */
export interface SqlJob {
  id: string;
  sql: string;
  reason: string;           // ★ 强制备注：为什么要执行这条 SQL
  title?: string;           // ★ 标题：操作目的
  dbId: string;             // 目标数据库 ID（预配置的连接 ID）
  /** 内联连接参数 — 不依赖预配置，直接连接 */
  connection?: DbConnectionParams;
  /** 任务类型(缺省 'sql' 向后兼容;redis = Redis 危险操作) */
  kind?: JobKind;
  /** kind=redis 时的执行载荷 */
  redis?: RedisJobPayload;
  status: SqlJobStatus;
  submittedAt: number;      // 提交时间戳
  reviewedAt?: number;      // 审批时间戳
  rejectReason?: string;    // 拒绝原因
  result?: SqlResult;       // 执行结果
  error?: string;           // 错误信息
}

/** SQL 执行结果 */
export interface SqlResult {
  rows?: Record<string, unknown>[];
  affectedRows?: number;
  insertId?: number;
  changes?: number;
  executionTime: number;    // 毫秒
}

/** AI 查询历史记录 */
export interface SqlHistoryEntry {
  id: string;
  title: string;            // ★ 标题：为什么查/改这次数据库
  sql: string;
  dbId: string;             // 数据库 ID 或名称
  dbLabel?: string;         // 数据库显示标签
  connection?: DbConnectionParams;
  result: SqlResult;        // 执行结果
  executedAt: number;       // 执行时间
}

/** 查询 SQL 的请求体 */
export interface QuerySqlBody {
  sql: string;
  dbId: string;
  title: string;            // ★ 必填：查询标题
  connection?: DbConnectionParams;
}

/** 提交 SQL 的请求体 */
export interface SubmitSqlBody {
  sql: string;
  reason: string;
  dbId: string;
  title: string;            // ★ 必填：操作标题
  /** 内联连接参数（优先级高于 dbId） */
  connection?: DbConnectionParams;
}

/** 文件状态（内存中跟踪） */
export interface FileState {
  mtime: number;
  size: number;
  pos: number;
  lastActive: number;
}

/** 原始 config.json 结构（含 ttyd、jwt 等） */
export interface RawConfig {
  reviewMode?: boolean;
  terminalDefaultCwd?: string;
  ttyd?: {
    port: number;
    command: string;
    args?: string;
  };
  jwt?: {
    expiryHours: number;
  };
}

/** 终端 session 信息（内存） */
export interface TerminalSessionInfo {
  port: number;
  label: string;
  command: string;
  cwd: string;
  createdAt: number;
}

/** SSE 广播消息 */
export interface SseMessage {
  file: string;
  name: string;
  exists: boolean;
  content: string;
  changed: boolean;
  timestamp: number;
  project?: string;       // 所属项目 id —— SSE 按项目过滤防串扰
}
