import { createTestDatabase } from "@/db/client";
import { updatePinnedClear } from "@/db/queries";

type StartMessage = { type: "start" };

const [databaseUrl, userIdValue, runId, nowValue] = process.argv.slice(2);

void main();

async function main() {
  if (!databaseUrl || !userIdValue || !runId || !nowValue) {
    send({ type: "error", name: "Error", message: "Missing pin process arguments." });
    process.exitCode = 1;
    return;
  }

  const userId = Number(userIdValue);
  const now = Number(nowValue);
  const bundle = await createTestDatabase(databaseUrl);
  send({ type: "ready" });

  process.once("message", async (message: unknown) => {
    if (!isStartMessage(message)) return;

    try {
      const result = await updatePinnedClear(userId, { runId, pinned: true }, bundle.db, now);
      send({ type: "result", result: { type: "result", result } });
    } catch (error) {
      const details = error instanceof Error ? error : new Error(String(error));
      send({
        type: "result",
        result: { type: "error", name: details.name, message: details.message },
      });
    } finally {
      bundle.sqlite.close();
      process.disconnect();
    }
  });
}

function isStartMessage(message: unknown): message is StartMessage {
  return typeof message === "object" && message !== null && "type" in message && message.type === "start";
}

function send(message: unknown) {
  process.send?.(message);
}
