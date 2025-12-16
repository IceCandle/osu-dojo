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

  // Ban maps: !dojo ban <1-based index1> <index2> ...
  const banMatch = command.match(/^!dojo\s+ban\s+(.+)$/);
  if (banMatch) {
    const indices = banMatch[1]
      .split(/\s+/)
      .map((value) => parseInt(value, 10))
      .filter((n) => Number.isFinite(n));

    await handleBan(message.user, username, indices);
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
    '  !dojo ban <index...> - Ban candidate maps by 1-based index during ban phase',
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

/**
 * Handle: !dojo ban <index1> <index2> ...
 *
 * Phase 1: 1-based index bans during ban phase.
 * The queue processor creates a short-lived ban session in Redis.
 * This command records the user's selection into Redis for the processor to consume.
 */
async function handleBan(user: BanchoDmUser, username: string, indices: number[]): Promise<void> {
  if (indices.length === 0) {
    await user.sendMessage('Usage: !dojo ban <index...> (example: !dojo ban 1 3)');
    return;
  }

  const { osuApi } = await import('@/lib/osu-api');
  const { getPendingBanAttemptIdForOsuId, getBanSession, recordBanSelection } =
    await import('@/lib/redis');

  // Identify the user (osuId) so we can find the correct ban session.
  let osuUser: unknown | null;
  try {
    osuUser = await osuApi.getUser(username);
  } catch (error) {
    logger.error('osu! user lookup failed during ban command', { username, error });
    await user.sendMessage('Could not verify your osu! account right now. Please try again.');
    return;
  }

  if (!osuUser) {
    await user.sendMessage('Could not verify your osu! account right now. Please try again.');
    return;
  }

  type OsuUserData = { id: number };
  const osuUserData = osuUser as unknown as Partial<OsuUserData>;
  if (!osuUserData || typeof osuUserData.id !== 'number') {
    await user.sendMessage('Could not verify your osu! account right now. Please try again.');
    return;
  }

  const attemptId = await getPendingBanAttemptIdForOsuId(osuUserData.id);
  if (!attemptId) {
    await user.sendMessage('No active ban phase right now.');
    return;
  }

  const session = await getBanSession(attemptId);
  if (!session) {
    await user.sendMessage('Ban phase expired.');
    return;
  }

  const candidateCount = session.candidates.length;
  const uniqueIndices = Array.from(new Set(indices))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidateCount)
    .slice(0, session.maxBans);

  if (uniqueIndices.length === 0) {
    await user.sendMessage(
      `No valid indices. Please pick 1-${candidateCount}. Example: !dojo ban 1 3`,
    );
    return;
  }

  const bannedBeatmapDbIds = uniqueIndices
    .map((idx) => session.candidates[idx - 1])
    .filter((c): c is (typeof session.candidates)[number] => !!c)
    .map((c) => c.beatmapDbId);

  await recordBanSelection(
    {
      attemptId,
      selectedAt: Date.now(),
      indices: uniqueIndices,
      bannedBeatmapDbIds,
    },
    120,
  );

  await user.sendMessage(`Recorded bans: ${uniqueIndices.join(', ')} (max ${session.maxBans}).`);

  logger.info('Ban selection recorded', {
    username,
    attemptId,
    indices: uniqueIndices,
    bannedCount: bannedBeatmapDbIds.length,
  });
}
