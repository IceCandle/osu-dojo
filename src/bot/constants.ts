/**
 * Bot Configuration Constants
 * Single source of truth for all hardcoded timeout and limit values
 */

/**
 * Timeout values in milliseconds (unless specified otherwise)
 */
export const BOT_TIMEOUTS = {
  /** Player join timeout (5 minutes) */
  PLAYER_JOIN_MS: 5 * 60 * 1000,

  /** Ban phase user response timeout (30 seconds) */
  BAN_PHASE_MS: 30_000,

  /** Ban selection poll interval (500ms) */
  BAN_POLL_INTERVAL_MS: 500,

  /** Queue blocking timeout (5 seconds) */
  QUEUE_DEQUEUE_SECONDS: 5,

  /** Match start countdown (5 seconds) */
  MATCH_START_COUNTDOWN_SECONDS: 5,

  /** Lobby close delay after completion (10 seconds) */
  LOBBY_CLOSE_DELAY_MS: 10_000,

  /** Heartbeat interval (1 minute) */
  HEARTBEAT_INTERVAL_MS: 60_000,

  /** Heartbeat timeout threshold (5 minutes) - consider lobby zombie */
  HEARTBEAT_TIMEOUT_MS: 5 * 60 * 1000,

  /** Stuck lobby check interval (1 minute) */
  STUCK_LOBBY_CHECK_INTERVAL_MS: 60 * 1000,

  /** Queue error retry delay (5 seconds) */
  QUEUE_ERROR_RETRY_MS: 5_000,
} as const;

/**
 * Limits and configuration values
 */
export const BOT_LIMITS = {
  /** Ban session TTL in Redis (60 seconds) */
  BAN_SESSION_TTL_SECONDS: 60,

  /** Ban selection TTL in Redis (120 seconds) */
  BAN_SELECTION_TTL_SECONDS: 120,

  /** DM message chunk size (12 lines per message) */
  DM_CHUNK_SIZE: 12,

  /** Lobby state expiry in Redis (24 hours) */
  LOBBY_STATE_TTL_SECONDS: 86400,

  /** Leaderboard cache TTL (1 hour) */
  LEADERBOARD_CACHE_TTL_SECONDS: 3600,
} as const;

/**
 * Recovery-related configuration
 */
export const BOT_RECOVERY = {
  /** Match history timestamp tolerance (1 minute) */
  MATCH_RECONCILIATION_TOLERANCE_MS: 60_000,
} as const;
