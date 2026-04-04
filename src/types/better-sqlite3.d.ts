declare module "better-sqlite3" {
  export interface Options {}

  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export default class Database {
    constructor(filename?: string, options?: Options);
    pragma(source: string): unknown;
    exec(source: string): this;
    close(): void;
  }
}
