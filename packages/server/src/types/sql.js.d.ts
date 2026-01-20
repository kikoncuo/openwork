/**
 * Type declarations for sql.js
 * This provides basic types for the sql.js module used in the server
 */

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  export interface Database {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
  }

  export interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(params?: Record<string, unknown>): Record<string, unknown>
    free(): void
  }

  export interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export interface SqlJsConfig {
    locateFile?: (filename: string) => string
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}
