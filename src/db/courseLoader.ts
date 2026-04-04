import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { PassConditionType } from "@/lib/domain";
import { validateCourseMods } from "@/lib/mods";

interface CourseBeatmapSeed {
  id: string;
  beatmapId: number;
  mods: string;
  passConditionType: PassConditionType;
  passConditionThreshold: number;
  ordinal: number;
}

interface CourseDanSeed {
  id: string;
  name: string;
  slug: string;
  description: string;
  ordinal: number;
  overallPassType: PassConditionType | null;
  overallPassThreshold: number | null;
  beatmaps: CourseBeatmapSeed[];
}

export interface CourseSystemSeed {
  id: string;
  name: string;
  slug: string;
  description: string;
  dans: CourseDanSeed[];
}

export function loadCoursesFromDir(dir: string): CourseSystemSeed[] {
  const directory = path.resolve(dir);
  const filenames = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  return filenames.map((filename) => {
    const filePath = path.join(directory, filename);
    const raw = readFileSync(filePath, "utf8");

    try {
      return parseCourseSystem(JSON.parse(raw), filePath);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`${filePath}: ${error.message}`);
      }

      throw error;
    }
  });
}

function parseCourseSystem(value: unknown, source: string): CourseSystemSeed {
  const record = expectRecord(value, "course system", source);

  return {
    id: expectString(record.id, "id", source),
    name: expectString(record.name, "name", source),
    slug: expectString(record.slug, "slug", source),
    description: expectString(record.description, "description", source),
    dans: expectArray(record.dans, "dans", source).map((dan, index) =>
      parseCourseDan(dan, `${source} dans[${index}]`),
    ),
  };
}

function parseCourseDan(value: unknown, source: string): CourseDanSeed {
  const record = expectRecord(value, "dan", source);

  return {
    id: expectString(record.id, "id", source),
    name: expectString(record.name, "name", source),
    slug: expectString(record.slug, "slug", source),
    description: expectString(record.description, "description", source),
    ordinal: expectInteger(record.ordinal, "ordinal", source),
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
  if (value === "acc" || value === "sv2") {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "acc" or "sv2".`,
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
