export const MAP_CONDITION_TYPES = [
  "accuracy",
  "score",
  "missCount",
  "maxCombo",
] as const;
export const COURSE_CONDITION_TYPES = [
  "courseAccuracy",
  "totalScore",
  "totalMissCount",
] as const;

export type MapPassConditionType = (typeof MAP_CONDITION_TYPES)[number];
export type CoursePassConditionType = (typeof COURSE_CONDITION_TYPES)[number];
export type PassConditionType = MapPassConditionType | CoursePassConditionType;
export type DanScoreModel = "scorev1" | "scorev2";
export type DanSystemStatus = "draft" | "current" | "legacy" | "archived";

export function isMapPassConditionType(
  value: unknown,
): value is MapPassConditionType {
  return (MAP_CONDITION_TYPES as readonly string[]).includes(value as string);
}

export function isCoursePassConditionType(
  value: unknown,
): value is CoursePassConditionType {
  return (COURSE_CONDITION_TYPES as readonly string[]).includes(value as string);
}

export interface MapPassCondition {
  type: MapPassConditionType;
  threshold: number;
}

export interface CoursePassCondition {
  type: CoursePassConditionType;
  threshold: number;
}

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
  ladder: string | null;
  ladderOrder: number;
}

export interface CourseBeatmapDefinition {
  id: string;
  beatmapId: number;
  mods: string;
  freemod: boolean;
  passConditions: MapPassCondition[];
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
  danSystemStatus: DanSystemStatus;
  danSystemLadder: string | null;
  danSystemLadderOrder: number;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  ordinal: number;
  official: boolean;
  label: string | null;
  scoreModel: DanScoreModel;
  overallPassConditions: CoursePassCondition[];
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
  passConditions: MapPassCondition[];
  score: number;
  rawScore: number;
  playedMods: string;
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

export interface PlayerDanBadge {
  courseId: string;
  systemId: string;
  systemName: string;
  ladderKey: string;
  label: string;
  ladderOrder: number;
  ordinal: number;
}

export interface PinnedClearView {
  runId: string;
  courseId: string;
  courseName: string;
  courseLabel: string | null;
  official: boolean;
  systemName: string;
  ordinal: number;
  scoreModel: DanScoreModel;
  summedAccuracy: number;
  totalScore: number;
  completedAt: number;
}

export interface RunPick {
  runId: string;
  courseId: string;
  courseName: string;
  courseLabel: string | null;
  systemName: string;
  completedAt: number;
  summedAccuracy: number;
  totalScore: number;
}

export interface PlayerRecentRun {
  id: string;
  courseId: string;
  courseName: string;
  courseLabel: string | null;
  systemName: string;
  status: "pass" | "fail" | "dnf";
  completedAt: number;
  matchId: number | null;
}

export interface PlayerMostPlayedCourse {
  courseId: string;
  courseName: string;
  courseLabel: string | null;
  systemName: string;
  playCount: number;
}

interface PlayerProfileIdentity {
  userId: number;
  username: string;
  avatarUrl: string;
  osuProfileUrl: string;
  highestOfficialDans: PlayerDanBadge[];
}

export interface PlayerProfileWithDetails extends PlayerProfileIdentity {
  detailsVisible: true;
  playCount: number;
  pinnedClears: PinnedClearView[];
  recentRuns: PlayerRecentRun[];
  mostPlayedCourses: PlayerMostPlayedCourse[];
}

export interface PlayerProfileWithoutDetails extends PlayerProfileIdentity {
  detailsVisible: false;
}

export type PlayerProfile = PlayerProfileWithDetails | PlayerProfileWithoutDetails;
