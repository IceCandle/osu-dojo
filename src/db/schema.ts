import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { PassConditionType } from "@/lib/domain";

export const danSystems = sqliteTable("dan_systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
});

export const dans = sqliteTable("dans", {
  id: text("id").primaryKey(),
  danSystemId: text("dan_system_id")
    .notNull()
    .references(() => danSystems.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  ordinal: integer("ordinal").notNull(),
  overallPassType: text("overall_pass_type").$type<PassConditionType | null>(),
  overallPassThreshold: real("overall_pass_threshold"),
});

export const danBeatmaps = sqliteTable("dan_beatmaps", {
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
});

export const results = sqliteTable("results", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  danId: text("dan_id")
    .notNull()
    .references(() => dans.id),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at").notNull(),
});

export const mapResults = sqliteTable("map_results", {
  id: text("id").primaryKey(),
  resultId: text("result_id")
    .notNull()
    .references(() => results.id),
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
});
