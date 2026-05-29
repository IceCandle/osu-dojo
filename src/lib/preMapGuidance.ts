import type {
  CourseBeatmapDefinition,
  CourseDefinition,
  JudgedMapResult,
  MapPassCondition,
} from "@/lib/domain";
import { formatInteger, formatPercentage } from "@/lib/format";
import { parseCourseMods, validateCourseMods } from "@/lib/mods";
import { rawTargetForAdjustedRemaining } from "@/lib/score";

type PriorMapResult = Pick<JudgedMapResult, "accuracy" | "countMiss" | "passed" | "score">;

interface BuildPreMapGuidanceOptions {
  course: CourseDefinition;
  beatmap: CourseBeatmapDefinition;
  priorMapResults: readonly PriorMapResult[];
  isFinalMap: boolean;
  // Only controls final-map course totalScore folding after impossibility was announced.
  courseAlreadyImpossible?: boolean;
}

export function buildPreMapGuidance({
  course,
  beatmap,
  priorMapResults,
  isFinalMap,
  courseAlreadyImpossible = false,
}: BuildPreMapGuidanceOptions): string[] {
  const lines: string[] = [];
  const finalAdjustedScoreTarget =
    isFinalMap && course.scoreModel === "scorev2"
      ? getEffectiveAdjustedScoreTarget(
          course,
          beatmap,
          priorMapResults,
          courseAlreadyImpossible,
        )
      : null;
  const useMergedFinalScoreTarget =
    finalAdjustedScoreTarget !== null && finalAdjustedScoreTarget > 0;
  let hasMapScoreTarget = false;
  const targets = beatmap.passConditions.map((condition) => {
    if (condition.type !== "score") {
      return formatMapTarget(condition, course.scoreModel, beatmap);
    }

    hasMapScoreTarget = true;
    if (!useMergedFinalScoreTarget) {
      return formatMapTarget(condition, course.scoreModel, beatmap);
    }

    return formatFinalScoreTarget(beatmap, finalAdjustedScoreTarget);
  });

  if (!hasMapScoreTarget && useMergedFinalScoreTarget) {
    targets.push(formatFinalScoreTarget(beatmap, finalAdjustedScoreTarget));
  }

  if (targets.length > 0) {
    lines.push(`Targets: ${targets.join(", ")}`);
  }

  if (beatmap.freemod) {
    lines.push("FreeMod allowed: NF optional, NM, HD, HR, HDHR");
  }

  if (beatmap.freemod && useMergedFinalScoreTarget) {
    lines.push(buildRawScoreByChoiceLine(finalAdjustedScoreTarget));
  }

  return lines;
}

function formatFinalScoreTarget(
  beatmap: CourseBeatmapDefinition,
  neededAdjusted: number,
): string {
  if (beatmap.freemod) {
    return `adjusted score >= ${formatInteger(neededAdjusted)}`;
  }

  return `raw score >= ${formatInteger(
    rawTargetForAdjustedRemaining(
      neededAdjusted,
      parseCourseMods(validateCourseMods(beatmap.mods)),
    ),
  )}`;
}

function buildRawScoreByChoiceLine(neededAdjusted: number): string {
  return `Raw score by choice: NM ${formatInteger(
    rawTargetForAdjustedRemaining(neededAdjusted, []),
  )} / HD ${formatInteger(
    rawTargetForAdjustedRemaining(neededAdjusted, ["HD"]),
  )} / HR ${formatInteger(
    rawTargetForAdjustedRemaining(neededAdjusted, ["HR"]),
  )} / HDHR ${formatInteger(
    rawTargetForAdjustedRemaining(neededAdjusted, ["HD", "HR"]),
  )}`;
}

function formatMapTarget(
  condition: MapPassCondition,
  scoreModel: CourseDefinition["scoreModel"],
  beatmap: CourseBeatmapDefinition,
): string {
  if (condition.type === "accuracy") {
    return `accuracy >= ${formatPercentage(condition.threshold)}`;
  }

  if (condition.type === "missCount") {
    return `miss <= ${formatInteger(condition.threshold)}`;
  }

  if (condition.type === "score") {
    if (scoreModel === "scorev1") {
      return `score >= ${formatInteger(condition.threshold)}`;
    }

    if (beatmap.freemod) {
      return `adjusted score >= ${formatInteger(condition.threshold)}`;
    }

    return `raw score >= ${formatInteger(
      rawTargetForAdjustedRemaining(
        condition.threshold,
        parseCourseMods(validateCourseMods(beatmap.mods)),
      ),
    )}`;
  }

  return `max combo >= ${formatInteger(condition.threshold)}`;
}

function findMapCondition(
  beatmap: CourseBeatmapDefinition,
  type: MapPassCondition["type"],
) {
  return beatmap.passConditions.find((condition) => condition.type === type);
}

function findCourseCondition(course: CourseDefinition, type: "totalScore") {
  return course.overallPassConditions.find((condition) => condition.type === type);
}

function getEffectiveAdjustedScoreTarget(
  course: CourseDefinition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
  courseAlreadyImpossible: boolean,
): number | null {
  const mapScoreThreshold = findMapCondition(beatmap, "score")?.threshold;
  const totalScoreCondition = courseAlreadyImpossible
    ? undefined
    : findCourseCondition(course, "totalScore");

  if (mapScoreThreshold === undefined && !totalScoreCondition) {
    return null;
  }

  const current = sum(priorMapResults.map((result) => result.score));
  const totalScoreRemaining = totalScoreCondition
    ? totalScoreCondition.threshold - current
    : 0;

  return Math.max(mapScoreThreshold ?? 0, totalScoreRemaining, 0);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
