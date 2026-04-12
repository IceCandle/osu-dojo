export type PassConditionType = "acc" | "score";
export type DanScoreModel = "scorev1" | "scorev2";

export type AccuracyRuleset = "osu" | string;
export type AccuracyClient = "stable" | "lazer" | string;

export interface AccuracyVariant {
  ruleset: AccuracyRuleset;
  client: AccuracyClient;
}

export const DEFAULT_ACCURACY_VARIANT = {
  ruleset: "osu",
  client: "stable",
} as const satisfies AccuracyVariant;

export interface DanBeatmapDefinition {
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
  annotations: string[];
}

export interface DanCourseDefinition {
  id: string;
  danSystemId: string;
  danSystemName: string;
  danSystemSlug: string;
  danSystemDescription: string;
  name: string;
  courseSlug: string;
  description: string;
  ordinal: number;
  scoreModel: DanScoreModel;
  overallPassType: PassConditionType | null;
  overallPassThreshold: number | null;
  beatmaps: DanBeatmapDefinition[];
}

export interface LegacyStableScoreStats {
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
}

export interface JudgedMapResult extends LegacyStableScoreStats {
  id: string;
  resultId: string;
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

export interface StoredRunResult {
  id: string;
  userId: number;
  username: string;
  danId: string;
  passed: boolean;
  startedAt: number;
  completedAt: number;
  matchId: number | null;
}
