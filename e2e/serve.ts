import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { seedE2eDatabase } from "./fixtures/seed";

const PORT = "3100";
const require = createRequire(import.meta.url);
const nextCliPath = require.resolve("next/dist/bin/next");
const tempDir = mkdtempSync(path.join(os.tmpdir(), "osudojo-e2e-"));
const databasePath = path.join(tempDir, "dojo.sqlite");
const databaseUrl = `file:${databasePath}`;
const keepDatabase = process.env["E2E_KEEP_DB"] === "1";

let server: ChildProcess | undefined;
let cleaned = false;
let shuttingDown = false;

function killServer() {
  if (!server?.pid || server.killed) {
    return;
  }

  try {
    server.kill("SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function cleanup(exitCode?: number) {
  if (cleaned) {
    return;
  }

  cleaned = true;
  killServer();

  if (!keepDatabase) {
    rmSync(tempDir, { recursive: true, force: true });
  } else {
    console.error(`Keeping e2e database at ${databasePath}`);
  }

  if (exitCode !== undefined) {
    process.exitCode = exitCode;
  }
}

async function main() {
  await seedE2eDatabase(databaseUrl);

  const useBuild = process.env["E2E_USE_BUILD"] === "1";
  const args = [nextCliPath, useBuild ? "start" : "dev", "-p", PORT];
  process.env["DATABASE_URL"] = databaseUrl;

  server = spawn(process.execPath, args, {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  server.on("error", (error) => {
    console.error(error);
    cleanup(1);
    process.exit(1);
  });

  server.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(`E2E server exited early: code=${code ?? "null"} signal=${signal ?? "null"}`);
    cleanup(code ?? 1);
    process.exit(code ?? 1);
  });
}

process.on("SIGTERM", () => {
  shuttingDown = true;
  cleanup(0);
  process.exit(0);
});
process.on("SIGINT", () => {
  shuttingDown = true;
  cleanup(0);
  process.exit(0);
});
process.on("exit", () => {
  cleanup();
});

main().catch((error: unknown) => {
  console.error(error);
  cleanup(1);
  process.exit(1);
});
