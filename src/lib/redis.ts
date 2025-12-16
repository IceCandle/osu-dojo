import Redis from 'ioredis';

/**
 * Redis Client Singleton
 * Prevents multiple instances in development due to hot reloading
 */

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis = globalForRedis.redis ?? new Redis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some(targetError => err.message.includes(targetError));
    },
  }
);

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

// Connection error handling
redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('Redis connected successfully');
});

/**
 * Redis Pub/Sub Channels
 * Used for real-time lobby updates
 */
export const REDIS_CHANNELS = {
  ATTEMPT_STARTED: (attemptId: number) => `lobby:${attemptId}:started`,
  MAP_CHANGED: (attemptId: number) => `lobby:${attemptId}:map-changed`,
  SCORE_UPDATE: (attemptId: number) => `lobby:${attemptId}:score`,
  ATTEMPT_COMPLETED: (attemptId: number) => `lobby:${attemptId}:completed`,
  ATTEMPT_FAILED: (attemptId: number) => `lobby:${attemptId}:failed`,
} as const;

/**
 * Redis Queue Keys
 * Used for bot attempt queue
 */
export const REDIS_QUEUES = {
  ATTEMPTS: 'queue:attempts',
} as const;

/**
 * Redis Cache Keys
 * Used for leaderboard and session caching
 */
export const REDIS_KEYS = {
  LEADERBOARD: (danId: number) => `leaderboard:${danId}`,
  ATTEMPT: (attemptId: number) => `attempt:${attemptId}`,
  USER_SESSION: (userId: number) => `session:${userId}`,
} as const;

/**
 * Redis Keys for Ban Phase
 * Used for 1-based index banning during candidate selection
 */
const REDIS_BAN_KEYS = {
  SESSION: (attemptId: number) => `ban:session:${attemptId}`,
  PENDING_FOR_OSU_ID: (osuId: number) => `ban:pending:osu:${osuId}`,
  SELECTION: (attemptId: number) => `ban:selection:${attemptId}`,
} as const;

export type BanSessionCandidate = {
  index: number; // 1-based
  beatmapDbId: number; // Beatmap.id (DB primary key)
  beatmapId: number; // osu! beatmap id
  title: string;
  candidateGroup: number;
};

export type BanSession = {
  attemptId: number;
  osuId: number;
  osuUsername: string;
  maxBans: number;
  createdAt: number;
  candidates: BanSessionCandidate[];
};

export type BanSelection = {
  attemptId: number;
  selectedAt: number;
  indices: number[]; // 1-based
  bannedBeatmapDbIds: number[];
};

export async function createBanSession(session: BanSession, ttlSeconds: number): Promise<void> {
  const sessionKey = REDIS_BAN_KEYS.SESSION(session.attemptId);
  const pendingKey = REDIS_BAN_KEYS.PENDING_FOR_OSU_ID(session.osuId);

  const pipeline = redis.pipeline();
  pipeline.set(sessionKey, JSON.stringify(session), 'EX', ttlSeconds);
  pipeline.set(pendingKey, session.attemptId.toString(), 'EX', ttlSeconds);
  // Ensure any previous selection is cleared
  pipeline.del(REDIS_BAN_KEYS.SELECTION(session.attemptId));
  await pipeline.exec();
}

export async function getBanSession(attemptId: number): Promise<BanSession | null> {
  const raw = await redis.get(REDIS_BAN_KEYS.SESSION(attemptId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as BanSession;
  } catch {
    return null;
  }
}

export async function getPendingBanAttemptIdForOsuId(osuId: number): Promise<number | null> {
  const raw = await redis.get(REDIS_BAN_KEYS.PENDING_FOR_OSU_ID(osuId));
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function recordBanSelection(selection: BanSelection, ttlSeconds: number): Promise<void> {
  await redis.set(
    REDIS_BAN_KEYS.SELECTION(selection.attemptId),
    JSON.stringify(selection),
    'EX',
    ttlSeconds
  );
}

export async function getBanSelection(attemptId: number): Promise<BanSelection | null> {
  const raw = await redis.get(REDIS_BAN_KEYS.SELECTION(attemptId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BanSelection;
  } catch {
    return null;
  }
}

export async function closeBanSession(attemptId: number, osuId: number): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.del(REDIS_BAN_KEYS.SESSION(attemptId));
  pipeline.del(REDIS_BAN_KEYS.SELECTION(attemptId));
  pipeline.del(REDIS_BAN_KEYS.PENDING_FOR_OSU_ID(osuId));
  await pipeline.exec();
}

/**
 * Publish attempt event to Redis
 */
export async function publishAttemptEvent(
  attemptId: number,
  event: keyof typeof REDIS_CHANNELS,
  data: Record<string, unknown>
): Promise<void> {
  const channel = REDIS_CHANNELS[event](attemptId);
  await redis.publish(channel, JSON.stringify(data));
}

/**
 * Add attempt to queue
 */
export async function enqueueAttempt(attemptId: number): Promise<void> {
  await redis.lpush(REDIS_QUEUES.ATTEMPTS, attemptId.toString());
}

/**
 * Get next attempt from queue (blocking)
 */
export async function dequeueAttempt(timeoutSeconds: number = 0): Promise<number | null> {
  const result = await redis.brpop(REDIS_QUEUES.ATTEMPTS, timeoutSeconds);
  return result ? parseInt(result[1], 10) : null;
}

/**
 * Cache leaderboard data
 */
export async function cacheLeaderboard(
  danId: number,
  attempts: Array<{ attemptId: number; totalScore: number }>
): Promise<void> {
  const key = REDIS_KEYS.LEADERBOARD(danId);

  // Use sorted set for automatic score ordering
  const pipeline = redis.pipeline();
  for (const { attemptId, totalScore } of attempts) {
    pipeline.zadd(key, Number(totalScore), attemptId.toString());
  }
  await pipeline.exec();

  // Set expiry (1 hour)
  await redis.expire(key, 3600);
}

/**
 * Get leaderboard from cache
 */
export async function getLeaderboard(
  danId: number,
  limit: number = 100
): Promise<Array<{ attemptId: number; totalScore: number }> | null> {
  const key = REDIS_KEYS.LEADERBOARD(danId);

  // Get top scores (descending order)
  const results = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');

  if (results.length === 0) return null;

  // Parse results
  const leaderboard: Array<{ attemptId: number; totalScore: number }> = [];
  for (let i = 0; i < results.length; i += 2) {
    leaderboard.push({
      attemptId: parseInt(results[i], 10),
      totalScore: parseInt(results[i + 1], 10),
    });
  }

  return leaderboard;
}

export default redis;
