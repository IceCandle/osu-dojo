import { createBotLogger } from "@/bot/logger";
import { createDojoBot, createLiveBotDependencies } from "@/bot/runtime";

const logger = createBotLogger();
const { client, fetchScore } = createLiveBotDependencies();
const bot = createDojoBot({ client, fetchScore, logger });
let shuttingDown = false;

async function stopGracefully(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("dojo bot stopping", { signal });

  try {
    await bot.stop();
    process.exit(0);
  } catch (error) {
    logger.error("dojo bot failed to stop cleanly", { error, signal });
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void stopGracefully("SIGINT");
});

process.on("SIGTERM", () => {
  void stopGracefully("SIGTERM");
});

bot
  .start()
  .then(() => {
    logger.info("dojo bot connected", {
      command: "!dojo start <system-name> <course-name>",
    });
  })
  .catch((error) => {
    logger.error("dojo bot failed to start", { error });
    process.exit(1);
  });
