/**
 * Type augmentations and definitions for bancho.js
 * The bancho.js library has incomplete TypeScript definitions
 */

declare module 'bancho.js' {
  /**
   * Augment BanchoLobby with proper event listener typing
   */
  interface BanchoLobby {
    on<TArgs extends unknown[]>(event: string, listener: (...args: TArgs) => void): void;
  }
}

/**
 * Match score from bancho.js match finished event
 * Represents a player's score in a multiplayer match
 */
export interface MatchScore {
  player: {
    user: {
      username: string;
      id: number;
    };
  };
  score: number;
  pass: boolean;
  accuracy: number;
  maxCombo: number;
  count300?: number;
  count100?: number;
  count50?: number;
  countMiss?: number;
}
