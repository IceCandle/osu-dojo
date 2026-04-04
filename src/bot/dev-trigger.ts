/**
 * Dev-only script: triggers a dan run for your own account
 * without needing a second account to send the !dojo DM.
 *
 * Usage: pnpm bot:dev <slug>
 *   e.g. pnpm bot:dev test-1dan
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDevLogger } from "@/bot/logger";
import { createDojoBot, createLiveBanchoClient, connectWithTimeout } from "@/bot/runtime";

const DEV_TRIGGER_FINAL_GRACE_PERIOD_MS = 60_000;
export const DEV_TRIGGER_EXIT_BUFFER_MS = 1_000;

function isRoomCreatedPrivateMessage(message: string) {
  return /^Created the tournament match\b/i.test(message);
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function attachDelayedRunEndedExit(options: {
  bot: { events: { on: (event: "runEnded", listener: () => void) => unknown } };
  exitCleanly: (code: number) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  finalGracePeriodMs: number;
  log?: (message: string) => void;
}) {
  let shutdownScheduled = false;
  const waitForShutdown =
    Math.max(0, options.finalGracePeriodMs) + DEV_TRIGGER_EXIT_BUFFER_MS;

  options.bot.events.on("runEnded", () => {
    if (shutdownScheduled) {
      return;
    }

    shutdownScheduled = true;
    options.log?.("Run finished. Exiting dev trigger after lobby grace period.");
    void (options.sleep ?? sleep)(waitForShutdown).then(() => options.exitCleanly(0));
  });
}

async function main() {
  const slug = process.argv[2];

  if (!slug) {
    console.error("Usage: pnpm bot:dev <slug>");
    process.exit(1);
  }

  const client = createLiveBanchoClient();
  const logger = createDevLogger(path.resolve(process.cwd(), "dojo-dev.jsonl"));
  const bot = createDojoBot({
    client,
    logger,
    connectOnStart: false,
    finalGracePeriodMs: DEV_TRIGGER_FINAL_GRACE_PERIOD_MS,
  });
  let exiting = false;

  async function exitCleanly(code: number) {
    if (exiting) {
      return;
    }

    exiting = true;
    await bot.stop();
    process.exit(code);
  }

  process.on("SIGINT", () => {
    void exitCleanly(0);
  });

  attachDelayedRunEndedExit({
    bot,
    exitCleanly,
    finalGracePeriodMs: DEV_TRIGGER_FINAL_GRACE_PERIOD_MS,
    log: (message) => {
      console.log(message);
    },
  });

  // Intercept BanchoBot PMs because they are swallowed by this standalone IRC connection
  client.on("PM", (pm) => {
    if (pm.user.ircUsername === "BanchoBot") {
      // The dev trigger prints a cleaner join link once the lobby is ready.
      if (isRoomCreatedPrivateMessage(pm.message)) {
        return;
      }

      console.log(`\n[BanchoBot]: ${pm.message}\n`);
    }
  });

  await connectWithTimeout(client);
  console.log("Connected to Bancho. Injecting dev trigger...");

  const selfUser = client.getSelf();
  const apiUser = await selfUser.fetchFromAPI();

  await bot.handlePrivateMessage({
    user: {
      id: apiUser.id,
      username: apiUser.username,
      ircUsername: selfUser.ircUsername,
      sendMessage: async (message) => {
        // We log the DM to the console because self-PMs don't reliably show up in game
        console.log(`[Bot DM to Game]: ${message}`);
        return null; // Don't actually send to selfUser to avoid silent drops
      },
    },
    message: `!dojo start ${slug}`,
    self: false,
  });

  const run = bot.activeRunsByUserId.get(apiUser.id);
  if (run && run.lobby) {
    console.log(`\n======================================================`);
    console.log(`🚀 ROOM CREATED!`);
    console.log(`Since you are running the bot on your own account,`);
    console.log(`Bancho routed the multiplayer invite to this terminal.`);
    console.log(`To join the room, click or copy the following link:`);
    console.log(`👉 osump://${run.lobby.id}/`);
    console.log(`======================================================\n`);
  } else {
    console.log(`Dev trigger sent: !dojo start ${slug}`);
  }

  console.log("Waiting for you to join the lobby. Press Ctrl+C to quit.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("Failed to run the dev trigger.", error);
    process.exit(1);
  });
}
