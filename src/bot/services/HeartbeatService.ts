import { createLogger } from '@/lib/core/logger';

/**
 * Service for managing lobby heartbeat updates
 *
 * Sends periodic heartbeat updates to Redis to track lobby health.
 * Used for zombie lobby detection and automatic recovery.
 *
 * @example
 * ```typescript
 * const heartbeat = new HeartbeatService();
 * heartbeat.start(multiplayerId);
 * // ... later ...
 * heartbeat.stop();
 * ```
 */
export class HeartbeatService {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logger = createLogger('HeartbeatService');
  private multiplayerId: string | null = null;

  /**
   * Start sending heartbeat updates every 60 seconds
   *
   * @param multiplayerId - The multiplayer lobby ID to track
   */
  start(multiplayerId: string): void {
    if (this.heartbeatTimer) {
      this.logger.warn('Heartbeat already running', { multiplayerId: this.multiplayerId });
      return;
    }

    this.multiplayerId = multiplayerId;
    this.logger.info('Starting heartbeat', { multiplayerId });

    this.heartbeatTimer = setInterval(async () => {
      try {
        const { updateHeartbeat } = await import('../recovery');
        await updateHeartbeat(multiplayerId);
      } catch (error) {
        this.logger.warn('Heartbeat update failed', { error, multiplayerId });
      }
    }, 60_000); // 60 seconds
  }

  /**
   * Stop sending heartbeat updates
   */
  stop(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    this.logger.info('Stopping heartbeat', { multiplayerId: this.multiplayerId });
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.multiplayerId = null;
  }

  /**
   * Check if heartbeat is currently running
   */
  isRunning(): boolean {
    return this.heartbeatTimer !== null;
  }
}
