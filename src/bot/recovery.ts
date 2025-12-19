/**
 * Bot Recovery System
 * Handles lobby state persistence and crash recovery
 *
 * Strategy: "Redis remembers everything, API reconciles the past"
 *
 * @deprecated This file re-exports from RecoveryService for backward compatibility
 * Import from '@/lib/services/RecoveryService' instead
 */

import { recoveryService } from '@/lib/services/RecoveryService';

// Re-export types
export type { LobbyState, MissingScore } from '@/lib/services/RecoveryService';

// Re-export service methods as functions for backward compatibility
export const saveLobbyState = recoveryService.saveLobbyState.bind(recoveryService);
export const getLobbyState = recoveryService.getLobbyState.bind(recoveryService);
export const deleteLobbyState = recoveryService.deleteLobbyState.bind(recoveryService);
export const updateHeartbeat = recoveryService.updateHeartbeat.bind(recoveryService);
export const findZombieLobbies = recoveryService.findZombieLobbies.bind(recoveryService);
export const findStuckLobbies = recoveryService.findStuckLobbies.bind(recoveryService);
export const reconcileMatchHistory = recoveryService.reconcileMatchHistory.bind(recoveryService);
export const abandonAttempt = recoveryService.abandonAttempt.bind(recoveryService);
export const checkStuckLobbies = recoveryService.checkStuckLobbies.bind(recoveryService);
