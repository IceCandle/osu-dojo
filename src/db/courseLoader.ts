import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  COURSE_CONDITION_TYPES,
  MAP_CONDITION_TYPES,
  isCoursePassConditionType,
  isMapPassConditionType,
} from "@/lib/domain";
import type {
  CoursePassCondition,
  CoursePassConditionType,
  DanScoreModel,
  DanSystemStatus,
  MapPassCondition,
  MapPassConditionType,
} from "@/lib/domain";
import { kebabizeName } from "@/lib/format";
import { validateCourseMods } from "@/lib/mods";

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
const LADDER_KEY_PATTERN = /^[a-z0-9-]+$/;
const MAX_COURSE_LABEL_LENGTH = 16;

interface CourseBeatmapSeed {
  id: string;
  beatmapId: number;
  mods: string;
  freemod: boolean;
  passConditions: MapPassCondition[];
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
  official?: boolean;
  label?: string | null;
  scoreModel: DanScoreModel;
  overallPassConditions: CoursePassCondition[];
  beatmaps: CourseBeatmapSeed[];
}

export interface DanSystemSeed {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: DanSystemStatus;
  ladder?: string | null;
  ladderOrder?: number;
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
  assertUniqueLadderOrders(systems);
  return systems;
}

function parseDanSystem(value: unknown, source: string): DanSystemSeed {
  const record = expectRecord(value, "course system", source);

  return {
    id: expectString(record["id"], "id", source),
    name: expectDisplayName(record["name"], "name", source),
    slug: expectString(record["slug"], "slug", source),
    description: expectString(record["description"], "description", source),
    status: expectDanSystemStatus(record["status"], "status", source),
    ladder: optionalLadderKey(record["ladder"], "ladder", source),
    ladderOrder: optionalInteger(record["ladderOrder"], "ladderOrder", source, 0),
    courses: expectArray(record["courses"], "courses", source).map((course, index) =>
      parseCourse(course, `${source} courses[${index}]`),
    ),
  };
}

function parseCourse(value: unknown, source: string): CourseSeed {
  const record = expectRecord(value, "course", source);
  const scoreModel = expectScoreModel(record["scoreModel"], "scoreModel", source);
  const beatmaps = expectArray(record["beatmaps"], "beatmaps", source).map(
    (beatmap, index) => parseCourseBeatmap(beatmap, `${source} beatmaps[${index}]`),
  );
  const overallPassConditions = expectCourseConditionList(
    record["overallPassConditions"],
    "overallPassConditions",
    source,
    beatmaps.length,
  );

  assertScorev1HasNoScoreConditions(scoreModel, beatmaps, overallPassConditions, source);

  return {
    id: expectString(record["id"], "id", source),
    name: expectDisplayName(record["name"], "name", source),
    slug: expectString(record["slug"], "slug", source),
    description: expectString(record["description"], "description", source),
    tags: optionalStringArray(record["tags"], "tags", source, []),
    ordinal: expectInteger(record["ordinal"], "ordinal", source),
    official: optionalBoolean(record["official"], "official", source, false),
    label: optionalNullableString(record["label"], "label", source),
    scoreModel,
    overallPassConditions,
    beatmaps,
  };
}

function parseCourseBeatmap(value: unknown, source: string): CourseBeatmapSeed {
  const record = expectRecord(value, "beatmap", source);

  return {
    id: expectString(record["id"], "id", source),
    beatmapId: expectInteger(record["beatmapId"], "beatmapId", source),
    mods: validateCourseMods(expectString(record["mods"], "mods", source)),
    freemod: optionalBoolean(record["freemod"], "freemod", source, false),
    passConditions: expectMapConditionList(
      record["passConditions"],
      "passConditions",
      source,
    ),
    ordinal: expectInteger(record["ordinal"], "ordinal", source),
    title: optionalString(record["title"], "title", source, ""),
    artist: optionalString(record["artist"], "artist", source, ""),
    difficultyName: optionalString(record["difficultyName"], "difficultyName", source, ""),
    mapper: optionalString(record["mapper"], "mapper", source, ""),
    coverUrl: optionalString(record["coverUrl"], "coverUrl", source, ""),
    annotations: expectStringArray(record["annotations"], "annotations", source),
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

function optionalBoolean(
  value: unknown,
  field: string,
  source: string,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${source} field "${field}" must be a boolean.`);
  }

  return value;
}

function optionalNullableString(
  value: unknown,
  field: string,
  source: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = expectString(value, field, source).trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed.length > MAX_COURSE_LABEL_LENGTH) {
    throw new Error(
      `${source} field "${field}" must be ${MAX_COURSE_LABEL_LENGTH} characters or fewer after trim.`,
    );
  }

  return trimmed;
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

function expectNumber(value: unknown, field: string, source: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
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

function optionalInteger(
  value: unknown,
  field: string,
  source: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  return expectInteger(value, field, source);
}

function optionalLadderKey(
  value: unknown,
  field: string,
  source: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = expectString(value, field, source).trim();
  if (trimmed === "") {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (!LADDER_KEY_PATTERN.test(normalized)) {
    throw new Error(
      `${source} field "${field}" must match ${LADDER_KEY_PATTERN} after lowercase normalization.`,
    );
  }

  return normalized;
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

function expectMapConditionList(
  value: unknown,
  field: string,
  source: string,
): MapPassCondition[] {
  const conditions = expectArray(value, field, source).map((condition, index) =>
    parseMapCondition(condition, `${source} ${field}[${index}]`),
  );

  if (conditions.length === 0) {
    throw new Error(`${source} field "${field}" must contain at least one condition.`);
  }

  assertUniqueConditionTypes(conditions, source, field);
  return sortConditions(conditions, MAP_CONDITION_TYPES);
}

function expectCourseConditionList(
  value: unknown,
  field: string,
  source: string,
  beatmapCount: number,
): CoursePassCondition[] {
  const conditions = expectArray(value, field, source).map((condition, index) =>
    parseCourseCondition(condition, `${source} ${field}[${index}]`, beatmapCount),
  );

  assertUniqueConditionTypes(conditions, source, field);
  return sortConditions(conditions, COURSE_CONDITION_TYPES);
}

function parseMapCondition(value: unknown, source: string): MapPassCondition {
  const record = expectRecord(value, "map pass condition", source);
  const type = expectMapConditionType(record["type"], "type", source);

  return {
    type,
    threshold: expectConditionThreshold(type, record["threshold"], "threshold", source, null),
  };
}

function parseCourseCondition(
  value: unknown,
  source: string,
  beatmapCount: number,
): CoursePassCondition {
  const record = expectRecord(value, "course pass condition", source);
  const type = expectCourseConditionType(record["type"], "type", source);

  return {
    type,
    threshold: expectConditionThreshold(
      type,
      record["threshold"],
      "threshold",
      source,
      beatmapCount,
    ),
  };
}

function expectMapConditionType(
  value: unknown,
  field: string,
  source: string,
): MapPassConditionType {
  if (isMapPassConditionType(value)) {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "accuracy", "score", "missCount", or "maxCombo".`,
  );
}

function expectCourseConditionType(
  value: unknown,
  field: string,
  source: string,
): CoursePassConditionType {
  if (isCoursePassConditionType(value)) {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "courseAccuracy", "totalScore", or "totalMissCount".`,
  );
}

function expectConditionThreshold(
  type: MapPassConditionType | CoursePassConditionType,
  value: unknown,
  field: string,
  source: string,
  beatmapCount: number | null,
): number {
  const threshold = expectNumber(value, field, source);

  if (type === "accuracy") {
    if (threshold < 0 || threshold > 100) {
      throw new Error(`${source} field "${field}" must be between 0 and 100.`);
    }

    return threshold;
  }

  if (type === "courseAccuracy") {
    const max = beatmapCount === null ? null : beatmapCount * 100;
    if (threshold < 0 || (max !== null && threshold > max)) {
      throw new Error(
        `${source} field "${field}" must be between 0 and ${max ?? "course maximum"}.`,
      );
    }

    return threshold;
  }

  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new Error(`${source} field "${field}" must be a non-negative integer.`);
  }

  return threshold;
}

function assertUniqueConditionTypes<T extends { type: string }>(
  conditions: T[],
  source: string,
  field: string,
) {
  const seen = new Set<string>();
  for (const condition of conditions) {
    if (seen.has(condition.type)) {
      throw new Error(
        `${source} field "${field}" contains duplicate pass condition type "${condition.type}".`,
      );
    }

    seen.add(condition.type);
  }
}

function sortConditions<T extends { type: string }>(
  conditions: T[],
  order: readonly string[],
): T[] {
  return [...conditions].sort(
    (left, right) => order.indexOf(left.type) - order.indexOf(right.type),
  );
}

function assertScorev1HasNoScoreConditions(
  scoreModel: DanScoreModel,
  beatmaps: CourseBeatmapSeed[],
  overallPassConditions: CoursePassCondition[],
  source: string,
) {
  if (scoreModel !== "scorev1") {
    return;
  }

  const hasMapScoreCondition = beatmaps.some((beatmap) =>
    beatmap.passConditions.some((condition) => condition.type === "score"),
  );
  const hasTotalScoreCondition = overallPassConditions.some(
    (condition) => condition.type === "totalScore",
  );

  if (hasMapScoreCondition || hasTotalScoreCondition) {
    throw new Error(
      `${source} scorev1 courses cannot use score or totalScore pass conditions.`,
    );
  }
}

function expectDanSystemStatus(
  value: unknown,
  field: string,
  source: string,
): DanSystemStatus {
  if (value === undefined) {
    return "current";
  }

  if (
    value === "draft" ||
    value === "current" ||
    value === "legacy" ||
    value === "archived"
  ) {
    return value;
  }

  throw new Error(
    `${source} field "${field}" must be "draft", "current", "legacy", or "archived".`,
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
    for (const course of system.courses) {
      const courseNameKey = kebabizeName(course.name);
      const existingCourseName = courseKeys.get(courseNameKey);
      if (existingCourseName) {
        throw new Error(
          `Duplicate course display name key "${courseNameKey}" in system "${system.name}" from "${existingCourseName}" and "${course.name}".`,
        );
      }
      courseKeys.set(courseNameKey, course.name);
    }
  }
}

function assertUniqueLadderOrders(systems: DanSystemSeed[]) {
  const ordersByLadder = new Map<string, Map<number, string>>();

  for (const system of systems) {
    if (!system.ladder) {
      continue;
    }

    const orders = ordersByLadder.get(system.ladder) ?? new Map<number, string>();
    const existingSystemName = orders.get(system.ladderOrder ?? 0);
    if (existingSystemName) {
      throw new Error(
        `Duplicate ladderOrder ${system.ladderOrder ?? 0} in ladder "${system.ladder}" from "${existingSystemName}" and "${system.name}".`,
      );
    }

    orders.set(system.ladderOrder ?? 0, system.name);
    ordersByLadder.set(system.ladder, orders);
  }
}
