import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

export function createTempDatabaseUrl(prefix: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(directory, "dojo.sqlite");

  return {
    directory,
    filePath,
    url: `file:${filePath}`,
    cleanup() {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}
