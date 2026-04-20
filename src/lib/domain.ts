export type PassConditionType = "acc" | "score";
export type DanScoreModel = "scorev1" | "scorev2";

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
