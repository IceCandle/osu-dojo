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
import {
  formatVisibleCourseMods,
  parseCourseMods,
  validateCourseMods,
} from "@/lib/mods";
import { rawTargetForAdjustedRemaining } from "@/lib/score";

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
  const finalAdjustedScoreTarget =
    isFinalMap && course.scoreModel === "scorev2"
      ? getEffectiveAdjustedScoreTarget(course, beatmap, priorMapResults)
      : null;
  const useFinalScoreTarget = finalAdjustedScoreTarget !== null;
  const targets = beatmap.passConditions
    .filter((condition) => !(useFinalScoreTarget && condition.type === "score"))
    .map((condition) => formatMapTarget(condition, course.scoreModel, beatmap));

  if (beatmap.freemod && finalAdjustedScoreTarget !== null && finalAdjustedScoreTarget > 0) {
    targets.unshift(`adjusted score >= ${formatInteger(finalAdjustedScoreTarget)}`);
  }

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
    lines.push(
      ...buildCourseTargetLines(course, beatmap, priorMapResults, {
        skipTotalScore: useFinalScoreTarget,
      }),
    );
    if (finalAdjustedScoreTarget !== null && finalAdjustedScoreTarget > 0) {
      lines.push(...buildFinalScoreTargetLines(beatmap, finalAdjustedScoreTarget));
    }
  }

  return lines;
}

function buildCourseTargetLines(
  course: CourseDefinition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
  options: { skipTotalScore?: boolean } = {},
): string[] {
  return course.overallPassConditions.flatMap((condition) => {
    if (condition.type === "courseAccuracy") {
      return buildCourseAccuracyTargetLine(condition, beatmap, priorMapResults);
    }

    if (condition.type === "totalScore") {
      if (options.skipTotalScore) {
        return [];
      }

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
    ? [`Course target: accuracy >= ${formatPercentage(remaining)}`]
    : [];
}

function buildTotalScoreTargetLine(
  condition: CoursePassCondition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
): string[] {
  const mapCondition = findMapCondition(beatmap, "score");
  const mapThreshold = mapCondition?.threshold ?? 0;
  const current = sum(priorMapResults.map((result) => result.score));
  const remaining = condition.threshold - current;
  const neededAdjusted = Math.max(mapThreshold, remaining, 0);
  const lines =
    remaining > 0
      ? [`Course target: total score >= ${formatInteger(remaining)}`]
      : [
          `Course target: total score already satisfied (${formatInteger(
            current,
          )} / ${formatInteger(condition.threshold)})`,
        ];

  if (neededAdjusted > 0) {
    const rawTarget = rawTargetForAdjustedRemaining(
      neededAdjusted,
      parseCourseMods(validateCourseMods(beatmap.mods)),
    );
    lines.push(
      `Raw target on this map: >= ${formatInteger(rawTarget)} (with ${formatVisibleCourseMods(
        beatmap.mods,
      )})`,
    );
  }

  return lines;
}

function buildFinalScoreTargetLines(
  beatmap: CourseBeatmapDefinition,
  neededAdjusted: number,
): string[] {
  return beatmap.freemod
    ? [
        `Raw target by choice: NM ${formatInteger(
          rawTargetForAdjustedRemaining(neededAdjusted, []),
        )} / HD ${formatInteger(
          rawTargetForAdjustedRemaining(neededAdjusted, ["HD"]),
        )} / HR ${formatInteger(
          rawTargetForAdjustedRemaining(neededAdjusted, ["HR"]),
        )} / HDHR ${formatInteger(
          rawTargetForAdjustedRemaining(neededAdjusted, ["HD", "HR"]),
        )}`,
      ]
    : [
        `Raw target: >= ${formatInteger(
          rawTargetForAdjustedRemaining(
            neededAdjusted,
            parseCourseMods(validateCourseMods(beatmap.mods)),
          ),
        )}`,
      ];
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
    ? [`Course target: miss <= ${formatInteger(remainingBudget)}`]
    : [];
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

function findCourseCondition(
  course: CourseDefinition,
  type: CoursePassCondition["type"],
) {
  return course.overallPassConditions.find((condition) => condition.type === type);
}

function hasScoreTarget(course: CourseDefinition, beatmap: CourseBeatmapDefinition) {
  return Boolean(findMapCondition(beatmap, "score") || findCourseCondition(course, "totalScore"));
}

function getEffectiveAdjustedScoreTarget(
  course: CourseDefinition,
  beatmap: CourseBeatmapDefinition,
  priorMapResults: readonly PriorMapResult[],
): number | null {
  const mapScoreThreshold = findMapCondition(beatmap, "score")?.threshold;
  const totalScoreCondition = findCourseCondition(course, "totalScore");

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
