/**
 * User-Facing Bot Messages
 * All bot messages centralized for easy updates and i18n support
 */

/**
 * Lobby and attempt messages
 */
export const LOBBY_MESSAGES = {
  /** Map cleared successfully */
  mapCleared: (mapIndex: number, totalMaps: number, score: bigint) =>
    `Map ${mapIndex + 1}/${totalMaps} cleared! Score: ${score}`,

  /** Map failed message */
  mapFailed: (mapName: string, skillFocus: string | undefined, reason: string) => {
    const skill = skillFocus ? ` [${skillFocus}]` : '';
    return `${mapName}${skill}: ${reason}. Attempt ended.`;
  },

  /** Map finished but requirement not met (attempt continues) */
  mapRequirementMissed: (mapName: string, skillFocus: string | undefined, reason: string) => {
    const skill = skillFocus ? ` [${skillFocus}]` : '';
    return `${mapName}${skill}: ${reason}. Continuing, but this attempt can no longer PASS/GOLD.`;
  },

  /** Failure reasons */
  failureReason: {
    didNotComplete: 'Map failed (did not complete)',
    scoreTooLow: (score: bigint, required: bigint) => `Score too low (${score} < ${required})`,
    requirementsNotMet: (details?: string) => details || 'Requirements not met',
  },

  /** Gold clear message */
  goldClear: (totalScore: bigint) =>
    `🏆 GOLD CLEAR! All maps cleared with gold requirements. Total: ${totalScore}`,

  /** Normal clear message */
  normalClear: (totalScore: bigint) => `🎉 NORMAL CLEAR! All maps passed. Total: ${totalScore}`,

  /** Attempt finished (not fully passed) */
  attemptFinished: (mapsCompleted: number, totalMaps: number, totalScore: bigint) =>
    `Attempt finished. Completed ${mapsCompleted}/${totalMaps} maps. Total: ${totalScore}`,

  /** Player join/leave */
  playerJoined: (username: string) => `Player joined: ${username}`,
  playerLeft: (username: string) => `Player left: ${username}`,
  playerDidNotJoin: 'Player did not join in time. Closing lobby.',
  targetPlayerLeft: 'Target player left. Aborting attempt.',
} as const;

/**
 * DM command responses
 */
export const DM_COMMANDS_MESSAGES = {
  /** Help command response */
  help: [
    'osu!dojo Bot Commands:',
    '  !dojo start <danId> - Start a dan attempt',
    '  !dojo list - View available dans',
    '',
    'Example: !dojo start 1',
  ].join('\n'),

  /** Unknown command */
  unknownCommand: 'Unknown command. Type "!dojo" for help.',

  /** Attempt created successfully */
  attemptCreated: (attemptId: number, danName: string) =>
    `Attempt #${attemptId} created for "${danName}"! You'll be invited to the lobby shortly.`,

  /** User not found on osu! */
  userNotFound: (username: string) =>
    `User "${username}" not found on osu!. Please check your username.`,

  /** Verification failed */
  verificationFailed: 'Failed to verify your osu! account. Please try again later.',

  /** Dan not found */
  danNotFound: (danId: number) =>
    `Dan #${danId} not found. Use "!dojo list" to see available dans.`,

  /** User already has active attempt */
  activeAttemptExists: (attemptId: number) =>
    `You already have an active attempt (#${attemptId}). Complete it first.`,

  /** No dans available */
  noDansAvailable: 'No dans available yet.',

  /** List command footer */
  listFooter: 'Use "!dojo start <id>" to begin.',

  /** Welcome message */
  welcome: (username: string) => `Welcome to osu!dojo! Account created for ${username}.`,

} as const;

/**
 * Recovery messages
 */
export const RECOVERY_MESSAGES = {
  /** Lobby rejoined successfully */
  lobbyRejoined: (mapIndex: number) =>
    `[Recovery] ✓ Rejoined lobby, resuming from map ${mapIndex + 1}`,

  /** Recovery failed */
  recoveryFailed: (matchId: string) => `[Recovery] ✗ Failed to recover ${matchId}`,

  /** Fallback: created new attempt */
  fallbackCreated: (newAttemptId: number) =>
    `[Recovery] Fallback: created and queued fresh attempt #${newAttemptId}`,
} as const;

/**
 * Log messages (for console/logger output, not user-facing)
 */
export const LOG_MESSAGES = {
  playerJoined: (username: string) => `Player joined: ${username}`,
  playerLeft: (username: string) => `Player left: ${username}`,
  playerDidNotJoin: 'Player did not join in time. Closing lobby.',
  targetPlayerLeft: 'Target player left. Aborting attempt.',
  heartbeatFailed: 'Heartbeat update failed',
  onDoneFailed: 'onDone callback failed',
} as const;
