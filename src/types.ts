// ── Shared types for read-log v2 ──────────────────────────

/** 数据库连接类型 */
export type DbType = 'mysql' | 'sqlite';

/** 数据库连接配置 */
export interface DbConnection {
  id: string;           // 唯一标识
  name: string;         // 显示名称，如 "生产数据库"
  type: DbType;
  version: string;      // 版本号，如 "8.0" / "3"
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

/** 日志条目 */
export interface LogEntry {
  name: string;
  file: string;
  groupKey: string;
  groupName: string;
  port?: number;          // 服务端口号，用于存活检测
}

/** 日志分组 */
export interface LogGroup {
  name: string;
  logs: { name: string; file: string; port?: number }[];
}

/** 应用配置（config.json — 仅 reviewMode，groups/databases 已迁 SQLite） */
export interface AppConfig {
  groups: Record<string, LogGroup>;
  reviewMode: boolean;
}

/** SQL 执行任务状态 */
export type SqlJobStatus =
  | 'pending'     // 待审批
  | 'approved'    // 已批准（即将执行）
  | 'rejected'    // 已拒绝
  | 'executed'    // 执行成功
  | 'failed';     // 执行失败

/** SQL 执行任务 */
export interface SqlJob {
  id: string;
  sql: string;
  reason: string;           // ★ 强制备注：为什么要执行这条 SQL
  dbId: string;             // 目标数据库 ID
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

/** 提交 SQL 的请求体 */
export interface SubmitSqlBody {
  sql: string;
  reason: string;
  dbId: string;
}

/** 文件状态（内存中跟踪） */
export interface FileState {
  mtime: number;
  size: number;
  pos: number;
  lastActive: number;
}

/** SSE 广播消息 */
export interface SseMessage {
  file: string;
  name: string;
  exists: boolean;
  content: string;
  changed: boolean;
  timestamp: number;
}
