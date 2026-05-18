import type {
  CoursePassCondition,
  CoursePassConditionType,
  CourseDefinition,
  JudgedMapResult,
  MapPassCondition,
  MapPassConditionType,
  PassConditionType,
} from "@/lib/domain";

export interface JudgedThreshold {
  type: PassConditionType;
  threshold: number;
  value: number;
  comparison: ">=" | "<=";
  passed: boolean;
}

export interface JudgedCourseRunResult {
  passed: boolean;
  allMapsPassed: boolean;
  overall: JudgedThreshold[];
}

export type CoursePassabilityMapResult = Pick<
  JudgedMapResult,
  "accuracy" | "countMiss" | "ordinal" | "passed"
>;

export type CourseImpossibilityReason =
  | { type: "mapFailed"; mapOrdinal: number }
  | { type: "totalMissCountExceeded"; value: number; threshold: number }
  | { type: "courseAccuracyUnreachable"; threshold: number; bestPossible: number };

export interface CoursePassabilityResult {
  passable: boolean;
  reasons: CourseImpossibilityReason[];
}

export function judgeThreshold(
  type: PassConditionType,
  threshold: number,
  value: number,
  comparison: ">=" | "<=" = ">=",
): JudgedThreshold {
  return {
    type,
    threshold,
    value,
    comparison,
    passed: comparison === ">=" ? value >= threshold : value <= threshold,
  };
}

export function evaluateMapConditions(
  conditions: MapPassCondition[],
  stats: { accuracy: number; score: number; countMiss: number; maxCombo: number },
): { passed: boolean; evaluations: JudgedThreshold[] } {
  const values = {
    accuracy: stats.accuracy,
    score: stats.score,
    missCount: stats.countMiss,
    maxCombo: stats.maxCombo,
  } satisfies Record<MapPassConditionType, number>;

  const evaluations = conditions.map((condition) =>
    judgeThreshold(
      condition.type,
      condition.threshold,
      values[condition.type],
      condition.type === "missCount" ? "<=" : ">=",
    ),
  );

  return {
    passed: evaluations.every((evaluation) => evaluation.passed),
    evaluations,
  };
}

export function evaluateCourseConditions(
  conditions: CoursePassCondition[],
  mapResults: JudgedMapResult[],
): { passed: boolean; evaluations: JudgedThreshold[] } {
  const values = {
    courseAccuracy: sum(
      mapResults.filter((result) => result.passed).map((result) => result.accuracy),
    ),
    totalScore: sum(mapResults.map((result) => result.score)),
    totalMissCount: sum(mapResults.map((result) => result.countMiss)),
  } satisfies Record<CoursePassConditionType, number>;

  const evaluations = conditions.map((condition) =>
    judgeThreshold(
      condition.type,
      condition.threshold,
      values[condition.type],
      condition.type === "totalMissCount" ? "<=" : ">=",
    ),
  );

  return {
    passed: evaluations.every((evaluation) => evaluation.passed),
    evaluations,
  };
}

export function judgeCourseRun(
  course: CourseDefinition,
  mapResults: JudgedMapResult[],
): JudgedCourseRunResult {
  const allMapsPassed = mapResults.every((result) => result.passed);

  if (!allMapsPassed) {
    return {
      passed: false,
      allMapsPassed,
      overall: [],
    };
  }

  if (course.overallPassConditions.length === 0) {
    return {
      passed: true,
      allMapsPassed,
      overall: [],
    };
  }

  const overall = evaluateCourseConditions(course.overallPassConditions, mapResults);

  return {
    passed: allMapsPassed && overall.passed,
    allMapsPassed,
    overall: overall.evaluations,
  };
}

export function assessCoursePassability(
  course: Pick<CourseDefinition, "overallPassConditions" | "beatmaps">,
  mapResults: readonly CoursePassabilityMapResult[],
): CoursePassabilityResult {
  const reasons: CourseImpossibilityReason[] = [];
  // Cumulative impossibility: any prior failed map makes the course unpassable.
  // Surface only the most-recent failed map; runtime gates repeat announcements.
  const latestFailedMap = [...mapResults].reverse().find((result) => !result.passed);

  if (latestFailedMap) {
    reasons.push({ type: "mapFailed", mapOrdinal: latestFailedMap.ordinal });
  }

  const remainingMapCount = Math.max(course.beatmaps.length - mapResults.length, 0);

  for (const condition of course.overallPassConditions) {
    if (condition.type === "totalMissCount") {
      const value = sum(mapResults.map((result) => result.countMiss));
      if (value > condition.threshold) {
        reasons.push({
          type: "totalMissCountExceeded",
          value,
          threshold: condition.threshold,
        });
      }
      continue;
    }

    if (condition.type === "courseAccuracy") {
      const priorPassedAccuracy = sum(
        mapResults.filter((result) => result.passed).map((result) => result.accuracy),
      );
      const bestPossible = priorPassedAccuracy + remainingMapCount * 100;
      if (bestPossible < condition.threshold) {
        reasons.push({
          type: "courseAccuracyUnreachable",
          threshold: condition.threshold,
          bestPossible,
        });
      }
    }
  }

  return {
    passable: reasons.length === 0,
    reasons,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
