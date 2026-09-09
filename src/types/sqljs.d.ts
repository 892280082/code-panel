// ── sql.js 类型声明(社区无官方 d.ts;按本项目实际用到的面手工声明,行/值宽松 any)──
declare module 'sql.js' {

  /** exec() 的结果形状:列名 + 按行取值 */
  export interface QueryExecResult { columns: string[]; values: any[][] }

  export interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: unknown): Record<string, any>;
    free(): void;
  }

  export interface Database {
    exec(sql: string, params?: unknown[]): QueryExecResult[];
    run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number };
    prepare(sql: string): Statement;
    getRowsModified(): number;
    close(): void;
    export(): Uint8Array;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => Database;
  }

  function initSqlJs(config?: unknown): Promise<SqlJsStatic>;
  export default initSqlJs;
}
