export type PassConditionType = "acc" | "sv2";

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
}

export interface DanCourseDefinition {
  id: string;
  danSystemId: string;
  danSystemName: string;
  name: string;
  slug: string;
  description: string;
  ordinal: number;
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
}
