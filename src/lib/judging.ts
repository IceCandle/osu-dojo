import type {
  CourseDefinition,
  JudgedMapResult,
  PassConditionType,
} from "@/lib/domain";

export interface JudgedThreshold {
  type: PassConditionType;
  threshold: number;
  value: number;
  passed: boolean;
}

export interface JudgedCourseRunResult {
  passed: boolean;
  allMapsPassed: boolean;
  overall: JudgedThreshold | null;
}

export function judgeThreshold(
  type: PassConditionType,
  threshold: number,
  values: { accuracy: number; score: number },
): JudgedThreshold {
  const value = type === "acc" ? values.accuracy : values.score;

  return {
    type,
    threshold,
    value,
    passed: value >= threshold,
  };
}

export function judgeCourseRun(
  course: CourseDefinition,
  mapResults: JudgedMapResult[],
): JudgedCourseRunResult {
  const allMapsPassed = mapResults.every((result) => result.passed);

  if (course.overallPassType === null || course.overallPassThreshold === null) {
    return {
      passed: allMapsPassed,
      allMapsPassed,
      overall: null,
    };
  }

  const overallValue =
    course.overallPassType === "acc"
      ? sum(mapResults.filter((result) => result.passed).map((result) => result.accuracy))
      : sum(mapResults.map((result) => result.score));

  const overall = {
    type: course.overallPassType,
    threshold: course.overallPassThreshold,
    value: overallValue,
    passed: overallValue >= course.overallPassThreshold,
  } satisfies JudgedThreshold;

  return {
    passed: allMapsPassed && overall.passed,
    allMapsPassed,
    overall,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
