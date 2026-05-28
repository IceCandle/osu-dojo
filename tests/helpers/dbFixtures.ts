import { createTestDatabase } from "@/db/client";
import type { DanSystemSeed } from "@/db/courseLoader";
import { getCourseByNameKey } from "@/db/queries";
import { cloneCourseSystems } from "@/db/seed";
import { createTempDatabaseUrl as createTempDatabaseUrlWithPrefix } from "./tempDatabase";

export const createTempDatabaseUrl = () => createTempDatabaseUrlWithPrefix("osudojo-");

export const SEEDED_SYSTEM_NAME_KEY = "test";
export const SEEDED_COURSE_NAME_KEY = "1st";
export const SEEDED_COURSE_SLUG = "test-1dan";
export const SEEDED_SECOND_COURSE_SLUG = "test-2dan";

export type SeedCourse = DanSystemSeed["courses"][number];
export type SeedBeatmap = SeedCourse["beatmaps"][number];
export type HydratedCourse = NonNullable<Awaited<ReturnType<typeof getCourseByNameKey>>>;

export function addSampleBeatmapMetadata(systems: ReturnType<typeof cloneCourseSystems>) {
  const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
  const secondCourse = systems[0]?.courses.find(
    (entry) => entry.slug === SEEDED_SECOND_COURSE_SLUG,
  );

  if (!seededCourse || !seededCourse.beatmaps[0] || !seededCourse.beatmaps[1] || !secondCourse?.beatmaps[0]) {
    throw new Error("Missing seeded test beatmaps.");
  }

  seededCourse.beatmaps[0] = {
    ...seededCourse.beatmaps[0],
    title: "test stage one",
    artist: "osu!dojo",
    difficultyName: "Opening",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/315/covers/cover.jpg",
  };
  seededCourse.beatmaps[1] = {
    ...seededCourse.beatmaps[1],
    title: "test stage two",
    artist: "osu!dojo",
    difficultyName: "Finale",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/259/covers/cover.jpg",
  };
  secondCourse.beatmaps[0] = {
    ...secondCourse.beatmaps[0],
    title: "test stage three",
    artist: "osu!dojo",
    difficultyName: "ScoreV1",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/4923775/covers/cover.jpg",
  };

  return systems;
}

export function markSeededCourseDraft(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  systems: ReturnType<typeof cloneCourseSystems>,
) {
  db.$client
    .prepare("UPDATE dan_systems SET status = 'draft' WHERE slug = ?")
    .run(SEEDED_SYSTEM_NAME_KEY);

  const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
  if (!seededCourse) {
    throw new Error("Missing seeded test course.");
  }
  systems[0]!.status = "draft";
  return seededCourse;
}

export function replaceSeedBeatmap(
  course: SeedCourse,
  beatmapId: string,
  replace: (beatmap: SeedBeatmap) => SeedBeatmap,
) {
  const index = course.beatmaps.findIndex((beatmap) => beatmap.id === beatmapId);
  if (index === -1) {
    throw new Error(`Missing seeded beatmap ${beatmapId}.`);
  }

  course.beatmaps[index] = replace(course.beatmaps[index]!);
}

export function requireCourseBeatmap(course: HydratedCourse, beatmapId: string) {
  const beatmap = course.beatmaps.find((entry) => entry.id === beatmapId);
  if (!beatmap) {
    throw new Error(`Missing course beatmap ${beatmapId}.`);
  }

  return beatmap;
}
