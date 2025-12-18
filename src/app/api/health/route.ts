import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { redis, scanKeys } from '@/lib/core/redis';

/**
 * Health check endpoint for monitoring system status
 * Checks PostgreSQL, Redis, and IRC bot connectivity
 *
 * Returns:
 * - 200 if all services healthy
 * - 503 if any service degraded or unhealthy
 */

interface ServiceHealth {
  status: 'up' | 'down';
  latency?: number;
  message?: string;
  queueDepth?: number;
  activeLobbies?: number;
  connected?: boolean;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    bot: ServiceHealth;
  };
}

export async function GET() {
  const health: HealthResponse = {
    status: 'healthy',
    timestamp: Date.now(),
    services: {
      database: { status: 'up' },
      redis: { status: 'up' },
      bot: { status: 'up' },
    },
  };

  let lobbyKeys: string[] = [];

  try {
    lobbyKeys = await scanKeys('lobby:*', { count: 500, maxKeys: 25_000 });
  } catch {
    lobbyKeys = [];
  }

  // 1. Check PostgreSQL
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1 as health_check`;
    health.services.database = {
      status: 'up',
      latency: Date.now() - start,
    };
  } catch (error) {
    health.services.database = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Unknown database error',
    };
    health.status = 'unhealthy';
  }

  // 2. Check Redis
  try {
    await redis.ping();
    const queueDepth = await redis.llen('queue:attempts');
    const activeLobbies = lobbyKeys.length;

    health.services.redis = {
      status: 'up',
      queueDepth,
      activeLobbies,
    };
  } catch (error) {
    health.services.redis = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Unknown Redis error',
    };
    health.status = 'unhealthy';
  }

  // 3. Check Bot (via Redis heartbeat)
  try {
    if (lobbyKeys.length === 0) {
      // No active lobbies - bot is idle but healthy
      health.services.bot = {
        status: 'up',
        message: 'No active lobbies (bot idle)',
        connected: true,
      };
    } else {
      // Check most recent heartbeat across all lobbies
      const pipeline = redis.pipeline();
      for (const key of lobbyKeys) {
        pipeline.hget(key, 'lastHeartbeat');
      }
      const results = await pipeline.exec();

      let mostRecentHeartbeat = 0;
      for (const [err, value] of results ?? []) {
        if (err) continue;
        const heartbeat = parseInt(String(value ?? '0'), 10);
        if (Number.isFinite(heartbeat) && heartbeat > mostRecentHeartbeat) {
          mostRecentHeartbeat = heartbeat;
        }
      }

      const timeSinceHeartbeat = Date.now() - mostRecentHeartbeat;
      const HEARTBEAT_TIMEOUT = 2 * 60 * 1000; // 2 minutes

      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT) {
        health.services.bot = {
          status: 'down',
          connected: false,
          message: `No heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`,
        };
        health.status = 'degraded';
      } else {
        health.services.bot = {
          status: 'up',
          connected: true,
        };
      }
    }
  } catch (error) {
    health.services.bot = {
      status: 'down',
      message: error instanceof Error ? error.message : 'Unknown bot status error',
    };
    health.status = 'degraded';
  }

  // Return appropriate HTTP status code
  const statusCode = health.status === 'healthy' ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
