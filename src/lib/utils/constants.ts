/**
 * General-purpose constants for lib/ modules
 * These are domain-level constants used across the application
 *
 * Note: Bot-specific constants are in src/bot/constants.ts
 */

/**
 * Replay validation constants
 */
export const REPLAY_VALIDATION = {
  /** Timestamp tolerance for replay validation (5 seconds) */
  TIMESTAMP_TOLERANCE_MS: 5000,

  /** Maximum file size for replay uploads (10MB) */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,

  /** Allowed file extensions for replay uploads */
  ALLOWED_EXTENSIONS: ['.osr'] as const,

  /** Maximum filename length after sanitization */
  MAX_FILENAME_LENGTH: 100,
} as const;

/**
 * Cache TTL values (in seconds)
 * Used for general-purpose caching in lib/services
 */
export const CACHE_TTL = {
  /** Leaderboard cache duration (1 hour) */
  LEADERBOARD_SECONDS: 3600,

  /** Beatmap metadata cache (24 hours) */
  BEATMAP_METADATA_SECONDS: 86400,

  /** User profile cache (30 minutes) */
  USER_PROFILE_SECONDS: 1800,

  /** Live stats in Redis (1 hour) */
  LIVE_STATS_SECONDS: 3600,
} as const;

/**
 * Scoring and gameplay constants
 */
export const SCORING = {
  /** Maximum score in ScoreV2 (before mod multipliers) */
  MAX_SCORE_V2: 1_000_000,

  /** Combo portion of score (70%) */
  COMBO_PORTION_WEIGHT: 0.7,

  /** Accuracy portion of score (30%) */
  ACCURACY_PORTION_WEIGHT: 0.3,
} as const;

/**
 * API and network constants
 */
export const API = {
  /** Default timeout for external API requests (30 seconds) */
  REQUEST_TIMEOUT_MS: 30_000,

  /** Rate limit window for API endpoints (1 minute) */
  RATE_LIMIT_WINDOW_MS: 60_000,
} as const;

/**
 * Game mode mapping
 * Maps osu! game modes to their numeric values
 */
export const GAME_MODE_MAP: Record<string, number> = {
  OSU: 0,
  TAIKO: 1,
  CATCH: 2,
  MANIA: 3,
} as const;
