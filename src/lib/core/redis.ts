import Redis from 'ioredis';

/**
 * Redis Client Singleton
 * Prevents multiple instances in development due to hot reloading
 */

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some((targetError) => err.message.includes(targetError));
    },
  });

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

export async function scanKeys(
  pattern: string,
  options?: { count?: number; maxKeys?: number },
): Promise<string[]> {
  const count = options?.count ?? 500;
  const maxKeys = options?.maxKeys ?? 25_000;

  let cursor = '0';
  const keys: string[] = [];

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    cursor = nextCursor;
    if (Array.isArray(batch) && batch.length > 0) {
      keys.push(...batch);
    }
  } while (cursor !== '0' && keys.length < maxKeys);

  return keys.slice(0, maxKeys);
}

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
 * Publish attempt event to Redis
 */
export async function publishAttemptEvent(
  attemptId: number,
  event: keyof typeof REDIS_CHANNELS,
  data: Record<string, unknown>,
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
  attempts: Array<{ attemptId: number; totalScore: number }>,
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
  limit: number = 100,
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
