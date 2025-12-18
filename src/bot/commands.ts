import { BanchoClient, BanchoMessage } from 'bancho.js';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BotCommands');

/**
 * Register DM command handlers
 * Called once during bot initialization
 */
export function registerCommands(bot: BanchoClient): void {
  bot.on('PM', async (message: BanchoMessage) => {
    try {
      await handleCommand(message);
    } catch (error) {
      logger.error('Command handling error', { error });
      await message.user.sendMessage('Sorry, an error occurred processing your command.');
    }
  });

  logger.info('DM command handlers registered');
}

type BanchoDmUser = BanchoMessage['user'];

const ATTEMPT_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_LIMIT_PER_WINDOW = 3;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

async function getAttemptLimitInfo(userId: number, dan: { id: number; danSystemId: number | null; tierInSystem: number | null }) {
  const windowStart = new Date(Date.now() - ATTEMPT_LIMIT_WINDOW_MS);

  const where =
    dan.danSystemId !== null && dan.tierInSystem !== null
      ? {
          userId,
          createdAt: { gte: windowStart },
          dan: { danSystemId: dan.danSystemId, tierInSystem: dan.tierInSystem },
        }
      : {
          userId,
          createdAt: { gte: windowStart },
          danId: dan.id,
        };

  const used = await prisma.attempt.count({ where });
  if (used < ATTEMPT_LIMIT_PER_WINDOW) return { allowed: true as const, used, remainingMs: 0 };

  const oldestInWindow = await prisma.attempt.findFirst({
    where,
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const oldestCreatedAtMs = oldestInWindow?.createdAt?.getTime();
  const nextAtMs = typeof oldestCreatedAtMs === 'number' ? oldestCreatedAtMs + ATTEMPT_LIMIT_WINDOW_MS : Date.now() + ATTEMPT_LIMIT_WINDOW_MS;
  const remainingMs = Math.max(0, nextAtMs - Date.now());

  return { allowed: false as const, used, remainingMs };
}

/**
 * Handle incoming DM command
 */
async function handleCommand(message: BanchoMessage): Promise<void> {
  const command = message.message.trim();
  const username = message.user.ircUsername;

  // Help command
  if (command === '!dojo' || command === '!help') {
    await sendHelp(message.user);
    return;
  }

  // Start attempt: !dojo start <danId>
  const startMatch = command.match(/^!dojo\s+start\s+(\d+)$/);
  if (startMatch) {
    const danId = parseInt(startMatch[1]);
    await handleStart(message.user, username, danId);
    return;
  }

  // List dans: !dojo list
  if (command === '!dojo list') {
    await handleList(message.user);
    return;
  }

  // Unknown command - send help
  await message.user.sendMessage(`Unknown command. Type "!dojo" for help.`);
}

/**
 * Send help message
 */
async function sendHelp(user: BanchoDmUser): Promise<void> {
  const helpText = [
    'osu!dojo Bot Commands:',
    '  !dojo start <danId> - Start a dan attempt',
    '  !dojo list - View available dans',
    '',
    'Example: !dojo start 1',
  ].join('\n');

  await user.sendMessage(helpText);
}

/**
 * Handle: !dojo start <danId>
 */
async function handleStart(user: BanchoDmUser, username: string, danId: number): Promise<void> {
  logger.info('Start command received', { username, danId });

  // Verify user exists via osu! API
  const { osuApi } = await import('@/lib/osu-api');
  let osuUser;

  try {
    osuUser = await osuApi.getUser(username);

    if (!osuUser) {
      await user.sendMessage(`User "${username}" not found on osu!. Please check your username.`);
      return;
    }
  } catch (error) {
    logger.error('User verification failed', { username, error });
    await user.sendMessage('Failed to verify your osu! account. Please try again later.');
    return;
  }

  // Extract osu! user ID from API response
  type OsuUserData = {
    id: number;
    username: string;
    avatar_url?: string;
    country_code?: string;
  };

  const osuUserData = osuUser as unknown as Partial<OsuUserData>;
  if (typeof osuUserData.id !== 'number' || typeof osuUserData.username !== 'string') {
    logger.error('Unexpected osu! API user response shape', { username });
    await user.sendMessage('Failed to verify your osu! account. Please try again later.');
    return;
  }

  // Check if user has account in database (using osuId as unique identifier)
  let dbUser = await prisma.user.findUnique({
    where: { osuId: osuUserData.id },
  });

  // Auto-create user if not exists
  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        osuId: osuUserData.id,
        osuUsername: osuUserData.username,
        avatarUrl: osuUserData.avatar_url,
        countryCode: osuUserData.country_code,
      },
    });

    logger.info('Auto-created user from API', {
      userId: dbUser.id,
      osuId: osuUserData.id,
    });

    await user.sendMessage(`Welcome to osu!dojo! Account created for ${osuUserData.username}.`);
  }

  // Verify dan exists
  const dan = await prisma.dan.findUnique({
    where: { id: danId },
  });

  if (!dan) {
    await user.sendMessage(`Dan #${danId} not found. Use "!dojo list" to see available dans.`);
    return;
  }

  // Check for active attempts
  const activeAttempt = await prisma.attempt.findFirst({
    where: {
      userId: dbUser.id,
      status: 'IN_PROGRESS',
    },
  });

  if (activeAttempt) {
    await user.sendMessage(
      `You already have an active attempt (#${activeAttempt.id}). Complete it first.`,
    );
    return;
  }

  // Attempt limit: rolling 24h window per certificate key (danSystemId + tierInSystem).
  // Starting consumes an attempt immediately.
  const limitInfo = await getAttemptLimitInfo(dbUser.id, {
    id: dan.id,
    danSystemId: dan.danSystemId ?? null,
    tierInSystem: dan.tierInSystem ?? null,
  });

  if (!limitInfo.allowed) {
    await user.sendMessage(
      `Attempt limit reached for this certificate (3/24h). Try again in ~${formatDuration(limitInfo.remainingMs)}.`,
    );
    return;
  }

  // Create attempt
  const attempt = await prisma.attempt.create({
    data: {
      userId: dbUser.id,
      danId,
      status: 'IN_PROGRESS',
    },
  });

  // Enqueue for processing
  const { enqueueAttempt } = await import('@/lib/redis');
  await enqueueAttempt(attempt.id);

  await user.sendMessage(
    `Attempt #${attempt.id} created for "${dan.name}"! You'll be invited to the lobby shortly.`,
  );

  logger.info('Attempt created via DM', {
    attemptId: attempt.id,
    userId: dbUser.id,
    danId,
  });
}

/**
 * Handle: !dojo list
 */
async function handleList(user: BanchoDmUser): Promise<void> {
  const dans = await prisma.dan.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { difficultyTier: 'asc' },
    take: 10,
  });

  if (dans.length === 0) {
    await user.sendMessage('No dans available yet.');
    return;
  }

  const lines = ['Available Dans:'];
  dans.forEach((dan) => {
    lines.push(`  #${dan.id} - ${dan.name} (Tier ${dan.difficultyTier})`);
  });
  lines.push('');
  lines.push('Use "!dojo start <id>" to begin.');

  await user.sendMessage(lines.join('\n'));
}

