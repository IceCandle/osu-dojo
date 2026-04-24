export type PassConditionType = "acc" | "score";
export type DanScoreModel = "scorev1" | "scorev2";
export type DanSystemStatus = "draft" | "current" | "legacy" | "archived";

export interface SystemCapabilities {
  playable: boolean;
  listed: boolean;
  persistRuns: boolean;
  frozen: boolean;
  badge: "draft" | "legacy" | null;
}

export function systemCapabilities(status: DanSystemStatus): SystemCapabilities {
  if (status === "draft") {
    return {
      playable: true,
      listed: false,
      persistRuns: false,
      frozen: false,
      badge: "draft",
    };
  }

  if (status === "current") {
    return {
      playable: true,
      listed: true,
      persistRuns: true,
      frozen: true,
      badge: null,
    };
  }

  if (status === "legacy") {
    return {
      playable: true,
      listed: true,
      persistRuns: true,
      frozen: true,
      badge: "legacy",
    };
  }

  return {
    playable: false,
    listed: false,
    persistRuns: false,
    frozen: true,
    badge: null,
  };
}

export function catalogSystemStatuses(): DanSystemStatus[] {
  return ["current", "legacy"];
}

export function playableSystemStatuses(): DanSystemStatus[] {
  return ["draft", "current", "legacy"];
}

export interface DanSystemDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: DanSystemStatus;
}

export interface CourseBeatmapDefinition {
  id: string;
  beatmapId: number;
  mods: string;
  passConditionType: PassConditionType;
  passConditionThreshold: number;
  ordinal: number;
  title: string;
  artist: string;
  difficultyName: string;
  mapper: string;
  coverUrl: string;
  totalObjects: number | null;
  annotations: string[];
}

export interface CourseDefinition {
  id: string;
  danSystemId: string;
  danSystemName: string;
  danSystemSlug: string;
  danSystemDescription: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  ordinal: number;
  scoreModel: DanScoreModel;
  overallPassType: PassConditionType | null;
  overallPassThreshold: number | null;
  beatmaps: CourseBeatmapDefinition[];
}

export interface StableScoreStats {
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
}

export interface JudgedMapResult extends StableScoreStats {
  id: string;
  runId: string;
  gameId: number | null;
  beatmapId: number;
  mods: string;
  passConditionType: PassConditionType;
  passConditionThreshold: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  passed: boolean;
  ordinal: number;
  createdAt: number;
}

export interface CourseRunResult {
  id: string;
  userId: number;
  username: string;
  courseId: string;
  passed: boolean;
  startedAt: number;
  completedAt: number;
  matchId: number | null;
}
