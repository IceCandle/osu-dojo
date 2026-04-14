import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DanScoreModel, PassConditionType } from "@/lib/domain";

export const danSystems = sqliteTable("dan_systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
});

export const dans = sqliteTable(
  "dans",
  {
    id: text("id").primaryKey(),
    danSystemId: text("dan_system_id")
      .notNull()
      .references(() => danSystems.id),
    name: text("name").notNull(),
    courseSlug: text("course_slug").notNull(),
    description: text("description").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
    scoreModel: text("score_model").$type<DanScoreModel>().notNull(),
    overallPassType: text("overall_pass_type").$type<PassConditionType | null>(),
    overallPassThreshold: real("overall_pass_threshold"),
  },
  (table) => [
    index("dans_system_ordinal_idx").on(table.danSystemId, table.ordinal),
  ],
);

export const danBeatmaps = sqliteTable(
  "dan_beatmaps",
  {
    id: text("id").primaryKey(),
    danId: text("dan_id")
      .notNull()
      .references(() => dans.id),
    beatmapId: integer("beatmap_id").notNull(),
    mods: text("mods").notNull(),
    passConditionType: text("pass_condition_type")
      .$type<PassConditionType>()
      .notNull(),
    passConditionThreshold: real("pass_condition_threshold").notNull(),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull().default(""),
    artist: text("artist").notNull().default(""),
    difficultyName: text("difficulty_name").notNull().default(""),
    mapper: text("mapper").notNull().default(""),
    coverUrl: text("cover_url").notNull().default(""),
    annotations: text("annotations").notNull().default("[]"),
  },
  (table) => [
    index("dan_beatmaps_dan_ordinal_idx").on(table.danId, table.ordinal),
  ],
);

export const results = sqliteTable(
  "results",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull(),
    username: text("username").notNull(),
    danId: text("dan_id")
      .notNull()
      .references(() => dans.id),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at").notNull(),
    matchId: integer("match_id"),
  },
  (table) => [
    index("results_dan_completed_idx").on(table.danId, table.completedAt),
  ],
);

export const mapResults = sqliteTable(
  "map_results",
  {
    id: text("id").primaryKey(),
    resultId: text("result_id")
      .notNull()
      .references(() => results.id),
    gameId: integer("game_id"),
    beatmapId: integer("beatmap_id").notNull(),
    mods: text("mods").notNull(),
    passConditionType: text("pass_condition_type")
      .$type<PassConditionType>()
      .notNull(),
    passConditionThreshold: real("pass_condition_threshold").notNull(),
    ordinal: integer("ordinal").notNull(),
    score: integer("score").notNull(),
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
    index("map_results_result_ordinal_idx").on(table.resultId, table.ordinal),
  ],
);
