/**
 * Core bot type definitions
 * Shared types for bot domain logic
 */

/**
 * Configuration for a single map in a dan attempt
 */
export interface MapConfig {
  id: number; // Beatmap.id (DB primary key)
  beatmapId: number; // osu! beatmap ID
  mods: string[]; // e.g., ["HD", "HR"]
  name?: string; // Display name for the map
  requiredScore: bigint; // Normal clear (pass) requirement
  goldClearScore: bigint; // Gold clear requirement
  skillFocus?: string; // e.g., "Jump", "Stream", "Tech", "Reading"
  gameMode?: string; // OSU, TAIKO, CATCH, MANIA
}

/**
 * Configuration for managing a dan attempt
 */
export interface AttemptConfig {
  attemptId: number; // Database attempt ID
  multiplayerId: string | null; // osu! multiplayer match ID
  username: string; // osu! username
  danName: string; // Dan name for display
  maps: MapConfig[]; // Final map list AFTER bans and candidate selection
  startMapIndex?: number; // 0-based map index for crash recovery
  onDone?: () => void; // Callback when attempt completes
}

/**
 * Individual map score within an attempt
 */
export interface MapScore {
  beatmapId: number; // Beatmap.id (DB primary key)
  score: bigint; // Final score
  passed: boolean; // Whether map was completed
  accuracy: number; // Accuracy as percentage (0-100)
  combo: number; // Max combo achieved
  count300: number; // Perfect hits
  count100: number; // Great hits
  count50: number; // Good hits
  countMiss: number; // Misses
  metRequirement: boolean; // Whether score met the requirement
}
