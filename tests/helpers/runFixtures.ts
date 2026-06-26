import type { CourseDefinition, JudgedMapResult } from "@/lib/domain";

export function passRun(
  userId: number,
  username: string,
  course: CourseDefinition,
  completedAt: number,
) {
  return {
    userId,
    username,
    courseId: course.id,
    passed: true,
    startedAt: completedAt - 60_000,
    completedAt,
    matchId: null,
    maps: course.beatmaps.map((beatmap, index) => ({
      gameId: completedAt + index,
      beatmapId: beatmap.beatmapId,
      mods: beatmap.mods,
      passConditions: beatmap.passConditions,
      ordinal: beatmap.ordinal,
      score: 1_000_000 - index,
      rawScore: 1_000_000 - index,
      playedMods: beatmap.mods,
      accuracy: 99 - index,
      maxCombo: 1_000,
      count300: 1_000,
      count100: 0,
      count50: 0,
      countMiss: 0,
      passed: true,
      createdAt: completedAt + index,
    })),
  };
}

export function dnfRun(
  userId: number,
  username: string,
  course: CourseDefinition,
  completedAt: number,
) {
  const beatmap = course.beatmaps[0];
  if (!beatmap) {
    throw new Error("Cannot build a DNF run for a course with no beatmaps.");
  }

  return {
    userId,
    username,
    courseId: course.id,
    passed: false,
    startedAt: completedAt - 60_000,
    completedAt,
    matchId: null,
    maps: [
      {
        gameId: completedAt,
        beatmapId: beatmap.beatmapId,
        mods: beatmap.mods,
        passConditions: beatmap.passConditions,
        ordinal: beatmap.ordinal,
        score: 100_000,
        rawScore: 100_000,
        playedMods: beatmap.mods,
        accuracy: 80,
        maxCombo: 100,
        count300: 800,
        count100: 100,
        count50: 50,
        countMiss: 10,
        passed: true,
        createdAt: completedAt,
      },
    ] satisfies Omit<JudgedMapResult, "id" | "runId">[],
  };
}
