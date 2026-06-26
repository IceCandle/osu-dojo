import { readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export default async function globalTeardown() {
  if (process.env["E2E_KEEP_DB"] === "1") {
    return;
  }

  for (const entry of readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("osudojo-e2e-")) {
      rmSync(path.join(os.tmpdir(), entry.name), { recursive: true, force: true });
    }
  }
}
