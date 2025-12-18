import { describe, it, expect, afterAll, beforeEach } from 'vitest';

import { redis, scanKeys } from '@/lib/core/redis';
import { findZombieLobbies } from '@/bot/recovery';

function hasRedisEnv(): boolean {
  return Boolean(process.env.REDIS_URL);
}

const maybeDescribe = hasRedisEnv() ? describe : describe.skip;

maybeDescribe('Crash Recovery', () => {
  beforeEach(async () => {
    // Prevent cross-test contamination.
    const keys = await scanKeys('lobby:*', { count: 500, maxKeys: 25_000 });
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('identifies zombie lobbies', async () => {
    const matchId = '12345_zombie';
    const lobbyKey = `lobby:${matchId}`;

    await redis.hset(lobbyKey, {
      attemptId: '9999',
      userId: '1',
      osuUsername: 'ZombieUser',
      danId: '1',
      danName: 'Zombie Dan',
      status: 'PLAYING',
      currentMapIndex: '0',
      matchId,
      channelName: `#mp_${matchId}`,
      botOsuId: '100',
      startedAt: Date.now().toString(),
      lastHeartbeat: (Date.now() - 60000).toString(),
      mapsCompleted: '0',
      mapDbIds: JSON.stringify([1]),
    });

    const zombies = await findZombieLobbies();

    expect(zombies).toHaveLength(1);
    expect(zombies[0].matchId).toBe(matchId);
    expect(zombies[0].osuUsername).toBe('ZombieUser');

    await redis.del(lobbyKey);
  });

  it('ignores completed lobbies', async () => {
    const matchId = '67890_completed';
    const lobbyKey = `lobby:${matchId}`;

    await redis.hset(lobbyKey, {
      attemptId: '9999',
      userId: '1',
      osuUsername: 'NotZombie',
      danId: '1',
      danName: 'Completed Dan',
      status: 'COMPLETED',
      currentMapIndex: '0',
      matchId,
      channelName: `#mp_${matchId}`,
      botOsuId: '100',
      startedAt: Date.now().toString(),
      lastHeartbeat: Date.now().toString(),
      mapsCompleted: '1',
      mapDbIds: JSON.stringify([1]),
    });

    const zombies = await findZombieLobbies();
    const found = zombies.find((z) => z.matchId === matchId);

    expect(found).toBeUndefined();

    await redis.del(lobbyKey);
  });
});
