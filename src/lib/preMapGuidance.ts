import type {
  CourseBeatmapDefinition,
  CourseDefinition,
  CoursePassCondition,
  JudgedMapResult,
  MapPassCondition,
} from "@/lib/domain";
import {
  formatInteger,
  formatPercentage,
} from "@/lib/format";

type PriorMapResult = Pick<JudgedMapResult, "accuracy" | "countMiss" | "passed" | "score">;

interface BuildPreMapGuidanceOptions {
  course: CourseDefinition;
  beatmap: CourseBeatmapDefinition;
  priorMapResults: readonly PriorMapResult[];
  isFinalMap: boolean;
}

export function buildPreMapGuidance({
  course,
  beatmap,
  priorMapResults,
  isFinalMap,
}: BuildPreMapGuidanceOptions): string[] {
  const lines: string[] = [];
  const targets = beatmap.passConditions.map(formatMapTarget);

  if (targets.length > 0) {
    lines.push(`Targets: ${targets.join(", ")}`);
  }

  if (beatmap.freemod) {
    lines.push("FreeMod allowed: NF optional, NM, HD, HR, HDHR");
    lines.push(
      "FreeMod active: add NF if you want the bot to receive your score after HP reaches 0.",
    );
  }

  if (isFinalMap) {
    lines.push(...buildCourseTargetLines(course, beatmap, priorMapResults));
  }

  return lines;
}

function buildCourseTargetLines(
  course: CourseDefinition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
): string[] {
  return course.overallPassConditions.flatMap((condition) => {
    if (condition.type === "courseAccuracy") {
      return buildCourseAccuracyTargetLine(condition, beatmap, priorMapResults);
    }

    if (condition.type === "totalScore") {
      return buildTotalScoreTargetLine(condition, beatmap, priorMapResults);
    }

    return buildTotalMissTargetLine(condition, beatmap, priorMapResults);
  });
}

function buildCourseAccuracyTargetLine(
  condition: CoursePassCondition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
): string[] {
  const mapCondition = findMapCondition(beatmap, "accuracy");
  const mapThreshold = mapCondition?.threshold ?? Number.NEGATIVE_INFINITY;
  const priorPassedAccuracy = sum(
    priorMapResults
      .filter((result) => result.passed)
      .map((result) => result.accuracy),
  );
  const remaining = condition.threshold - priorPassedAccuracy;

  if (remaining <= 0) {
    return mapCondition
      ? []
      : [
          `Course target: courseAccuracy already satisfied (${formatPercentage(
            priorPassedAccuracy,
          )} / ${formatPercentage(condition.threshold)})`,
        ];
  }

  return remaining > mapThreshold
    ? [`Course target: ${formatPercentage(remaining)}+ acc`]
    : [];
}

function buildTotalScoreTargetLine(
  condition: CoursePassCondition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
): string[] {
  const mapCondition = findMapCondition(beatmap, "score");
  const mapThreshold = mapCondition?.threshold ?? Number.NEGATIVE_INFINITY;
  const remaining = condition.threshold - sum(priorMapResults.map((result) => result.score));

  if (remaining <= 0) {
    const current = sum(priorMapResults.map((result) => result.score));
    return mapCondition
      ? []
      : [
          `Course target: totalScore already satisfied (${formatInteger(
            current,
          )} / ${formatInteger(condition.threshold)})`,
        ];
  }

  return remaining > mapThreshold
    ? [`Course target: totalScore >= ${formatInteger(remaining)}`]
    : [];
}

function buildTotalMissTargetLine(
  condition: CoursePassCondition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
): string[] {
  const mapCondition = findMapCondition(beatmap, "missCount");
  const mapThreshold = mapCondition?.threshold ?? Number.POSITIVE_INFINITY;
  const priorMisses = sum(priorMapResults.map((result) => result.countMiss));
  const remainingBudget = condition.threshold - priorMisses;

  if (remainingBudget < 0) {
    return [
      `Course target: totalMissCount already exceeded (${formatInteger(
        priorMisses,
      )} / ${formatInteger(condition.threshold)})`,
    ];
  }

  return remainingBudget < mapThreshold
    ? [`Course target: ${formatInteger(remainingBudget)} miss`]
    : [];
}

function formatMapTarget(condition: MapPassCondition): string {
  if (condition.type === "accuracy") {
    return `${formatPercentage(condition.threshold)}+ acc`;
  }

  if (condition.type === "missCount") {
    return `<=${formatInteger(condition.threshold)} miss`;
  }

  if (condition.type === "score") {
    return `score >= ${formatInteger(condition.threshold)}`;
  }

  return `${formatInteger(condition.threshold)}+ combo`;
}

function findMapCondition(
  beatmap: CourseBeatmapDefinition,
  type: MapPassCondition["type"],
) {
  return beatmap.passConditions.find((condition) => condition.type === type);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
