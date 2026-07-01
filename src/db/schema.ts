import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { DanScoreModel, DanSystemStatus } from "@/lib/domain";

export const danSystems = sqliteTable("dan_systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  status: text("status").$type<DanSystemStatus>().notNull().default("current"),
  ladder: text("ladder"),
  ladderOrder: integer("ladder_order").notNull().default(0),
});

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    danSystemId: text("dan_system_id")
      .notNull()
      .references(() => danSystems.id),
    creatorUserId: integer("creator_user_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    ordinal: integer("ordinal").notNull(),
    official: integer("official", { mode: "boolean" }).notNull().default(false),
    label: text("label"),
    scoreModel: text("score_model").$type<DanScoreModel>().notNull(),
    overallPassConditions: text("overall_pass_conditions")
      .$type<string>()
      .notNull()
      .default("[]"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("courses_system_ordinal_idx").on(table.danSystemId, table.ordinal),
    uniqueIndex("courses_system_slug_unique").on(table.danSystemId, table.slug),
  ],
);

export const beatmaps = sqliteTable(
  "beatmaps",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    beatmapId: integer("beatmap_id").notNull(),
    mods: text("mods").notNull(),
    freemod: integer("freemod", { mode: "boolean" }).notNull().default(false),
    passConditions: text("pass_conditions").$type<string>().notNull(),
    ordinal: integer("ordinal").notNull(),
    annotations: text("annotations").notNull().default("[]"),
  },
  (table) => [
    index("beatmaps_course_ordinal_idx").on(table.courseId, table.ordinal),
  ],
);

export const beatmapMetadata = sqliteTable("beatmap_metadata", {
  beatmapId: integer("beatmap_id").primaryKey(),
  title: text("title").notNull().default(""),
  artist: text("artist").notNull().default(""),
  difficultyName: text("difficulty_name").notNull().default(""),
  mapper: text("mapper").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  totalObjects: integer("total_objects"),
  fetchedAt: integer("fetched_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull(),
    username: text("username").notNull(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at").notNull(),
    matchId: integer("match_id"),
  },
  (table) => [
    index("runs_course_completed_idx").on(table.courseId, table.completedAt),
    index("runs_user_completed_idx").on(table.userId, table.completedAt),
  ],
);

export const mapResults = sqliteTable(
  "map_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    gameId: integer("game_id"),
    beatmapId: integer("beatmap_id").notNull(),
    mods: text("mods").notNull(),
    passConditions: text("pass_conditions").$type<string>().notNull(),
    ordinal: integer("ordinal").notNull(),
    score: integer("score").notNull(),
    rawScore: integer("raw_score").notNull().default(0),
    playedMods: text("played_mods").notNull().default(""),
    accuracy: real("accuracy").notNull(),
    maxCombo: integer("max_combo").notNull(),
    count300: integer("count_300").notNull(),
    count100: integer("count_100").notNull(),
    count50: integer("count_50").notNull(),
    countMiss: integer("count_miss").notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("map_results_run_ordinal_idx").on(table.runId, table.ordinal),
  ],
);

export const openLobbies = sqliteTable("open_lobbies", {
  matchId: integer("match_id").primaryKey(),
  userId: integer("user_id").notNull(),
  courseId: text("course_id").notNull(),
  openedAt: integer("opened_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    nonceHash: text("nonce_hash").notNull(),
    returnTo: text("return_to"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (table) => [index("oauth_states_expires_idx").on(table.expiresAt)],
);

export const users = sqliteTable("users", {
  osuUserId: integer("osu_user_id").primaryKey(),
  username: text("username").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("sessions_expires_idx").on(table.expiresAt)],
);
