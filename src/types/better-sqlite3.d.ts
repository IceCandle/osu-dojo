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

  export type Transaction<T extends (...args: never[]) => unknown> = T & {
    deferred: T;
    immediate: T;
    exclusive: T;
  };

  export default class Database {
    constructor(filename?: string, options?: Options);
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): Transaction<T>;
    close(): void;
  }
}
