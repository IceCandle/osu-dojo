/**
 * Dev-only script: triggers a dan run for your own account
 * without needing a second account to send the !dojo DM.
 *
 * Usage: pnpm bot:dev [<system-name> <course-name>]
 *   e.g. pnpm bot:dev test 1st
 */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createDevLogger } from "@/bot/logger";
import { createDojoBot, createLiveBanchoClient, connectWithTimeout } from "@/bot/runtime";

const DEV_TRIGGER_FINAL_GRACE_PERIOD_MS = 60_000;
export const DEV_TRIGGER_EXIT_BUFFER_MS = 1_000;
const USAGE_LINE = "Usage: pnpm bot:dev [<system-name> <course-name>]";

type DevTriggerArgs =
  | { type: "repl" }
  | { type: "start"; systemNameKey: string; courseNameKey: string }
  | { type: "usage-error" };

type ActiveRunsByUserIdLike = {
  get: (userId: number) => { lobby?: { id: number } } | undefined;
};

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

export function parseDevTriggerArgs(args: string[]): DevTriggerArgs {
  if (args.length === 0) {
    return { type: "repl" };
  }

  if (args.length === 2) {
    return {
      type: "start",
      systemNameKey: args[0],
      courseNameKey: args[1],
    };
  }

  return { type: "usage-error" };
}

export function getActiveLobbyId(
  activeRunsByUserId: ActiveRunsByUserIdLike,
  userId: number,
) {
  return activeRunsByUserId.get(userId)?.lobby?.id;
}

export function isNewLobbyCreated(
  previousLobbyId: number | undefined,
  nextLobbyId: number | undefined,
): nextLobbyId is number {
  return typeof nextLobbyId === "number" && nextLobbyId !== previousLobbyId;
}

function printRoomCreatedBanner(lobbyId: number) {
  console.log(`\n======================================================`);
  console.log(`ROOM CREATED!`);
  console.log(`Since you are running the bot on your own account,`);
  console.log(`Bancho routed the multiplayer invite to this terminal.`);
  console.log(`To join the room, click or copy the following link:`);
  console.log(`osump://${lobbyId}/`);
  console.log(`======================================================\n`);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const args = parseDevTriggerArgs(process.argv.slice(2));

  if (args.type === "usage-error") {
    console.error(USAGE_LINE);
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
  console.log("Connected to Bancho.");

  const selfUser = client.getSelf();
  const apiUser = await selfUser.fetchFromAPI();
  const injectedUser = {
    id: apiUser.id,
    username: apiUser.username,
    ircUsername: selfUser.ircUsername,
    sendMessage: async (message: string) => {
      // We log the DM to the console because self-PMs don't reliably show up in game.
      console.log(`[Bot DM to Game]: ${message}`);
      return null;
    },
  };

  async function injectCommand(message: string) {
    const previousLobbyId = getActiveLobbyId(bot.activeRunsByUserId, apiUser.id);

    await bot.handlePrivateMessage({
      user: injectedUser,
      message,
      self: false,
    });

    const nextLobbyId = getActiveLobbyId(bot.activeRunsByUserId, apiUser.id);
    if (isNewLobbyCreated(previousLobbyId, nextLobbyId)) {
      printRoomCreatedBanner(nextLobbyId);
    }
  }

  if (args.type === "start") {
    const startCommand = `!dojo start ${args.systemNameKey} ${args.courseNameKey}`;
    console.log(`Injecting dev trigger: ${startCommand}`);
    await injectCommand(startCommand);
  }

  console.log("Type !dojo commands below. Press Ctrl+D or Ctrl+C to quit.");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });
  rl.on("SIGINT", () => {
    void exitCleanly(0);
  });

  rl.prompt();
  for await (const line of rl) {
    const command = line.trim();

    if (command) {
      try {
        await injectCommand(command);
      } catch (error) {
        console.log(`[error] ${toErrorMessage(error)}`);
      }
    }

    rl.prompt();
  }

  await exitCleanly(0);
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
