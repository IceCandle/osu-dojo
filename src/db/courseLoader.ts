import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { CourseStatus, DanScoreModel, PassConditionType } from "@/lib/domain";
import { kebabizeName } from "@/lib/format";
import { validateCourseMods } from "@/lib/mods";

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;

interface CourseBeatmapSeed {
  id: string;
  beatmapId: number;
  mods: string;
  passConditionType: PassConditionType;
  passConditionThreshold: number;
  ordinal: number;
  title?: string;
  artist?: string;
  difficultyName?: string;
  mapper?: string;
  coverUrl?: string;
  annotations: string[];
}

interface CourseSeed {
  id: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  ordinal: number;
  status: CourseStatus;
  aliases: string[];
  scoreModel: DanScoreModel;
  overallPassType: PassConditionType | null;
  overallPassThreshold: number | null;
  beatmaps: CourseBeatmapSeed[];
}

export interface DanSystemSeed {
  id: string;
  name: string;
  slug: string;
  description: string;
  courses: CourseSeed[];
}

export function loadCoursesFromDir(dir: string): DanSystemSeed[] {
  const directory = path.resolve(dir);
  const filenames = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  const systems = filenames.map((filename) => {
    const filePath = path.join(directory, filename);
    const raw = readFileSync(filePath, "utf8");

    try {
      return parseDanSystem(JSON.parse(raw), filePath);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`${filePath}: ${error.message}`);
      }

      throw error;
    }
  });

  assertUniqueNameKeys(systems);
  return systems;
}

function parseDanSystem(value: unknown, source: string): DanSystemSeed {
  const record = expectRecord(value, "course system", source);

  return {
    id: expectString(record.id, "id", source),
    name: expectDisplayName(record.name, "name", source),
    slug: expectString(record.slug, "slug", source),
    description: expectString(record.description, "description", source),
    courses: expectArray(record.courses, "courses", source).map((course, index) =>
      parseCourse(course, `${source} courses[${index}]`),
    ),
  };
}

function parseCourse(value: unknown, source: string): CourseSeed {
  const record = expectRecord(value, "course", source);

  return {
    id: expectString(record.id, "id", source),
    name: expectDisplayName(record.name, "name", source),
    slug: expectString(record.slug, "slug", source),
    description: expectString(record.description, "description", source),
    tags: optionalStringArray(record.tags, "tags", source, []),
    ordinal: expectInteger(record.ordinal, "ordinal", source),
    status: expectCourseStatus(record.status, "status", source),
    aliases: optionalAliasArray(record.aliases, "aliases", source),
    scoreModel: expectScoreModel(record.scoreModel, "scoreModel", source),
    overallPassType: expectPassConditionTypeOrNull(
      record.overallPassType,
      "overallPassType",
      source,
    ),
    overallPassThreshold: expectNumberOrNull(
      record.overallPassThreshold,
      "overallPassThreshold",
      source,
    ),
    beatmaps: expectArray(record.beatmaps, "beatmaps", source).map((beatmap, index) =>
      parseCourseBeatmap(beatmap, `${source} beatmaps[${index}]`),
    ),
  };
}

function parseCourseBeatmap(value: unknown, source: string): CourseBeatmapSeed {
  const record = expectRecord(value, "beatmap", source);

  return {
    id: expectString(record.id, "id", source),
    beatmapId: expectInteger(record.beatmapId, "beatmapId", source),
    mods: validateCourseMods(expectString(record.mods, "mods", source)),
    passConditionType: expectPassConditionType(
      record.passConditionType,
      "passConditionType",
      source,
    ),
    passConditionThreshold: expectNumber(
      record.passConditionThreshold,
      "passConditionThreshold",
      source,
    ),
    ordinal: expectInteger(record.ordinal, "ordinal", source),
    title: optionalString(record.title, "title", source, ""),
    artist: optionalString(record.artist, "artist", source, ""),
    difficultyName: optionalString(record.difficultyName, "difficultyName", source, ""),
    mapper: optionalString(record.mapper, "mapper", source, ""),
    coverUrl: optionalString(record.coverUrl, "coverUrl", source, ""),
    annotations: expectStringArray(record.annotations, "annotations", source),
  };
}

function expectRecord(
  value: unknown,
  label: string,
  source: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must contain a ${label} object.`);
  }

  return value as Record<string, unknown>;
}

function expectArray(value: unknown, field: string, source: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} field "${field}" must be an array.`);
  }

  return value;
}

function expectString(value: unknown, field: string, source: string): string {
  if (typeof value !== "string") {
    throw new Error(`${source} field "${field}" must be a string.`);
  }

  return value;
}

function expectDisplayName(value: unknown, field: string, source: string): string {
  const name = expectString(value, field, source);

  if (!DISPLAY_NAME_PATTERN.test(name)) {
    throw new Error(
      `${source} field "${field}" must match ${DISPLAY_NAME_PATTERN}.`,
    );
  }

  return name;
}

function optionalString(
  value: unknown,
  field: string,
  source: string,
  fallback: string,
): string {
  if (value === undefined) {
    return fallback;
  }

  return expectString(value, field, source);
}

function expectStringArray(value: unknown, field: string, source: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${source} field "${field}" must be an array of strings.`);
  }

  return value;
}

function optionalStringArray(
  value: unknown,
  field: string,
  source: string,
  fallback: string[],
): string[] {
  if (value === undefined) {
    return fallback;
  }

  return expectStringArray(value, field, source);
}

function optionalAliasArray(value: unknown, field: string, source: string): string[] {
  return optionalStringArray(value, field, source, []).map((alias) =>
    expectAliasKey(alias, field, source),
  );
}

function expectAliasKey(value: string, field: string, source: string): string {
  const aliasKey = value.trim().toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(aliasKey)) {
    throw new Error(
      `${source} field "${field}" entries must be public name keys like "first-dan".`,
    );
  }

  return aliasKey;
}

function expectNumber(value: unknown, field: string, source: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${source} field "${field}" must be a number.`);
  }

  return value;
}

function expectInteger(value: unknown, field: string, source: string): number {
  const number = expectNumber(value, field, source);

  if (!Number.isInteger(number)) {
    throw new Error(`${source} field "${field}" must be an integer.`);
  }

  return number;
}

function expectNumberOrNull(
  value: unknown,
  field: string,
  source: string,
): number | null {
  if (value === null) {
    return null;
  }

  return expectNumber(value, field, source);
}

function expectPassConditionType(
  value: unknown,
  field: string,
  source: string,
): PassConditionType {
  if (value === "acc" || value === "score") {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "acc" or "score".`,
  );
}

function expectPassConditionTypeOrNull(
  value: unknown,
  field: string,
  source: string,
): PassConditionType | null {
  if (value === null) {
    return null;
  }

  return expectPassConditionType(value, field, source);
}

function expectScoreModel(
  value: unknown,
  field: string,
  source: string,
): DanScoreModel {
  if (value === "scorev1" || value === "scorev2") {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "scorev1" or "scorev2".`,
  );
}

function expectCourseStatus(
  value: unknown,
  field: string,
  source: string,
): CourseStatus {
  if (value === undefined) {
    return "published";
  }

  if (value === "draft" || value === "published" || value === "archived") {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "draft", "published", or "archived".`,
  );
}

function assertUniqueNameKeys(systems: DanSystemSeed[]) {
  const systemKeys = new Map<string, string>();

  for (const system of systems) {
    const systemNameKey = kebabizeName(system.name);
    const existingSystemName = systemKeys.get(systemNameKey);
    if (existingSystemName) {
      throw new Error(
        `Duplicate system display name key "${systemNameKey}" from "${existingSystemName}" and "${system.name}".`,
      );
    }
    systemKeys.set(systemNameKey, system.name);

    const courseKeys = new Map<string, string>();
    const nonArchivedCourseKeys = new Map<string, string>();
    const aliasKeys = new Map<string, string>();
    for (const course of system.courses) {
      const courseNameKey = kebabizeName(course.name);
      const existingCourseName = courseKeys.get(courseNameKey);
      if (existingCourseName) {
        throw new Error(
          `Duplicate course display name key "${courseNameKey}" in system "${system.name}" from "${existingCourseName}" and "${course.name}".`,
        );
      }
      courseKeys.set(courseNameKey, course.name);
      if (course.status !== "archived") {
        nonArchivedCourseKeys.set(courseNameKey, course.name);
      }

      for (const aliasKey of course.aliases) {
        const existingAliasName = aliasKeys.get(aliasKey);
        if (existingAliasName) {
          throw new Error(
            `Duplicate course alias key "${aliasKey}" in system "${system.name}" from "${existingAliasName}" and "${course.name}".`,
          );
        }
        aliasKeys.set(aliasKey, course.name);
      }
    }

    for (const [aliasKey, courseName] of aliasKeys) {
      const existingCourseName = nonArchivedCourseKeys.get(aliasKey);
      if (existingCourseName) {
        throw new Error(
          `Course alias key "${aliasKey}" in system "${system.name}" from "${courseName}" collides with course "${existingCourseName}".`,
        );
      }
    }
  }
}
