import type { LobbyLike } from "@/bot/runtime";
import type { CourseDefinition, DanSystemDefinition, JudgedMapResult } from "@/lib/domain";

export type ActiveRunStatus =
  | "waiting_for_player"
  | "countdown"
  | "playing_map"
  | "resolving_map"
  | "between_maps"
  | "finalizing"
  | "aborted";

export interface ActiveRun {
  runId: string;
  system: DanSystemDefinition;
  course: CourseDefinition;
  playerUserId: number;
  playerUsername: string;
  startedAt: number;
  lobby?: LobbyLike;
  currentBeatmapIndex: number;
  mapResults: Omit<JudgedMapResult, "id" | "runId">[];
  processedGameIds: Set<number>;
  status: ActiveRunStatus;
  lastProgressAt: number;
  inactivityTimer?: NodeJS.Timeout;
  countdownTimer?: NodeJS.Timeout;
  lobbyCloseTimer?: NodeJS.Timeout;
  startInFlight?: boolean;
  disposeListeners: Array<() => void>;
  targetPlayerFinishedCurrentMap: {
    score: number;
    pass: boolean;
    finishedAt: number;
  } | null;
  cleanupPromise?: Promise<void>;
  endEventEmitted?: boolean;
  impossibilityAnnounced?: boolean;
}

export function createRunRegistry() {
  const byUserId = new Map<number, ActiveRun>();
  const byLobbyId = new Map<number, ActiveRun>();

  return {
    byUserId,
    byLobbyId,
    register(run: ActiveRun) {
      byUserId.set(run.playerUserId, run);
    },
    attachLobby(run: ActiveRun) {
      if (!run.lobby) {
        throw new Error("Cannot attach a run without lobby state.");
      }

      byLobbyId.set(run.lobby.id, run);
    },
    addDispose(run: ActiveRun, fn: () => void) {
      run.disposeListeners.push(fn);
    },
    disposeAll(run: ActiveRun) {
      for (const dispose of run.disposeListeners.splice(0)) {
        dispose();
      }
    },
    unregister(run: ActiveRun) {
      byUserId.delete(run.playerUserId);
      if (run.lobby) {
        byLobbyId.delete(run.lobby.id);
      }
    },
    snapshot() {
      return [...byUserId.values()];
    },
    isTracked(run: ActiveRun) {
      return byUserId.get(run.playerUserId) === run;
    },
  };
}
