declare module "better-sqlite3" {
  export interface Options {}

  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export default class Database {
    constructor(filename?: string, options?: Options);
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    close(): void;
  }
}
