import { createLogger } from '@/lib/core/logger';

const logger = createLogger('RateLimiter');

/**
 * Token Bucket Rate Limiter
 *
 * Implements a token bucket algorithm for rate limiting API requests.
 * Tokens are refilled continuously at a fixed rate, allowing bursts up to capacity.
 *
 * @example
 * ```typescript
 * const limiter = new TokenBucket(1000, 60000); // 1000 requests/minute
 * await limiter.wait(); // Wait for token availability
 * // Make API request
 * ```
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond

  /**
   * Create a new token bucket rate limiter
   *
   * @param capacity - Maximum number of tokens (burst limit)
   * @param refillPeriodMs - Time period in milliseconds to refill all tokens
   * @example new TokenBucket(1000, 60000) // 1000 requests per minute
   */
  constructor(capacity: number, refillPeriodMs: number) {
    this.capacity = capacity;
    this.refillRate = capacity / refillPeriodMs;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Wait for a token to become available, consuming it
   *
   * If no tokens are available, waits until one is refilled.
   * Automatically refills tokens based on time elapsed.
   */
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

  /**
   * Refill tokens based on time elapsed since last refill
   * Called automatically by wait()
   */
  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get current number of available tokens (for monitoring/debugging)
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
