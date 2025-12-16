import { API, Ruleset } from 'osu-api-v2-js';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OsuApi');

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Token Bucket Rate Limiter
 * Implements 1000 requests/minute limit for osu! API v2
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity = 1000;
  private readonly refillRate = 1000 / 60000; // tokens per millisecond

  constructor() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  async wait(): Promise<void> {
    this.refill();

    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) / this.refillRate;
      logger.warn(`Rate limit reached, waiting ${Math.round(waitTime)}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.refill();
    }

    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * osu! API v2 Client Wrapper
 * Centralized wrapper for osu-api-v2-js with token management, rate limiting, and error handling
 */
class OsuApiClient {
  private botApi: API | null = null;
  private userApis: Map<number, API> = new Map();
  private rateLimiter = new TokenBucket();

  private getClientCredentials(): { clientId: number; clientSecret: string } {
    const rawId = process.env.OSU_CLIENT_ID;
    const clientSecret = process.env.OSU_CLIENT_SECRET;

    if (!rawId || !clientSecret) {
      throw new Error('Missing OSU_CLIENT_ID/OSU_CLIENT_SECRET');
    }

    const clientId = parseInt(rawId, 10);
    if (!Number.isFinite(clientId)) {
      throw new Error('Invalid OSU_CLIENT_ID');
    }

    return { clientId, clientSecret };
  }

  /**
   * Get bot API instance (client credentials flow)
   * Used for beatmap metadata, user verification, match history
   */
  async getBotApi(): Promise<API> {
    if (!this.botApi || this.isExpired(this.botApi)) {
      logger.info('Creating new bot API client');

      const { clientId, clientSecret } = this.getClientCredentials();

      this.botApi = await API.createAsync(clientId, clientSecret, undefined);

      // Enable auto-refresh on 401
      this.botApi.refresh_token_on_401 = true;

      // Retry on rate limit errors
      this.botApi.retry_on_status_codes = [429];
      this.botApi.retry_delay = 2; // 2 seconds initial delay
    }

    return this.botApi;
  }

  /**
   * Get user-specific API instance (authorization code flow)
   * Uses stored OAuth tokens from database
   */
  async getUserApi(userId: number): Promise<API> {
    const { clientId, clientSecret } = this.getClientCredentials();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        accessToken: true,
        refreshToken: true,
        tokenExpiry: true,
      },
    });

    if (!user?.accessToken) {
      throw new Error(`User ${userId} not authenticated with osu!`);
    }

    const api = new API({
      access_token: user.accessToken,
      refresh_token: user.refreshToken ?? undefined,
      client_id: clientId,
      client_secret: clientSecret,
      expires: user.tokenExpiry ? new Date(user.tokenExpiry.getTime()) : undefined,
    });

    // Enable auto-refresh and retry
    api.refresh_token_on_401 = true;
    api.retry_on_automatic_token_refresh = true;
    api.retry_on_status_codes = [429];
    api.retry_delay = 2;

    // Hook into token refresh to save to database
    const originalRefresh = api.refreshToken.bind(api);
    api.refreshToken = async () => {
      const result = await originalRefresh();
      await this.saveUserTokens(userId, api);
      return result;
    };

    return api;
  }

  /**
   * Save refreshed user tokens to database
   */
  private async saveUserTokens(userId: number, api: API): Promise<void> {
    if (!api.access_token || !api.refresh_token) {
      logger.error('Cannot save tokens: missing access_token or refresh_token');
      return;
    }

    logger.info('Saving refreshed tokens to database', { userId });

    await prisma.user.update({
      where: { id: userId },
      data: {
        accessToken: api.access_token,
        refreshToken: api.refresh_token,
        tokenExpiry:
          api.expires instanceof Date
            ? api.expires
            : api.expires
              ? new Date(api.expires * 1000)
              : null,
      },
    });
  }

  /**
   * Check if API instance token is expired
   */
  private isExpired(api: API): boolean {
    if (!api.expires) return false;
    const expiryTime = api.expires instanceof Date ? api.expires.getTime() : api.expires * 1000;
    return Date.now() >= expiryTime;
  }

  /**
   * Get beatmap metadata by beatmap ID
   */
  async getBeatmap(beatmapId: number): Promise<unknown | null> {
    await this.rateLimiter.wait();
    const api = await this.getBotApi();

    try {
      logger.info('Fetching beatmap metadata', { beatmapId });
      const beatmap = await api.getBeatmap(beatmapId);
      return beatmap;
    } catch (error: unknown) {
      const message = getErrorMessage(error);

      if (message.includes('404')) {
        logger.error('Beatmap not found', { beatmapId });
        return null;
      }
      if (message.includes('503')) {
        logger.error('osu! API unavailable (503)', { beatmapId });
        throw new Error('osu! API is currently unavailable. Please try again later.');
      }
      logger.error('Error fetching beatmap', { beatmapId, error });
      throw error;
    }
  }

  /**
   * Get user by username
   */
  async getUser(
    username: string,
    mode: 'osu' | 'taiko' | 'fruits' | 'mania' = 'osu',
  ): Promise<unknown | null> {
    await this.rateLimiter.wait();
    const api = await this.getBotApi();

    try {
      logger.info('Fetching user', { username, mode });
      // Convert mode string to Ruleset enum value
      const user = await api.getUser(username, Ruleset[mode]);
      return user;
    } catch (error: unknown) {
      const message = getErrorMessage(error);

      if (message.includes('404')) {
        logger.error('User not found', { username });
        return null;
      }
      if (message.includes('503')) {
        logger.error('osu! API unavailable (503)', { username });
        throw new Error('osu! API is currently unavailable. Please try again later.');
      }
      logger.error('Error fetching user', { username, error });
      throw error;
    }
  }

  /**
   * Get match history by match ID
   * Note: Match history only available for ~24 hours via osu! API
   */
  async getMatch(matchId: string): Promise<unknown | null> {
    await this.rateLimiter.wait();
    const api = await this.getBotApi();

    try {
      logger.info('Fetching match history', { matchId });
      const match = await api.getMatch(parseInt(matchId));
      return match;
    } catch (error: unknown) {
      const message = getErrorMessage(error);

      if (message.includes('404')) {
        logger.warn('Match not found (may be > 24h old)', { matchId });
        return null;
      }
      if (message.includes('503')) {
        logger.error('osu! API unavailable (503)', { matchId });
        throw new Error('osu! API is currently unavailable. Please try again later.');
      }
      logger.error('Error fetching match', { matchId, error });
      throw error;
    }
  }
}

// Singleton export
export const osuApi = new OsuApiClient();
