import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { backfillBeatmapMetadata } from "../scripts/backfill-metadata";

test("metadata backfill updates only incomplete rows through the batch boundary", async () => {
  const { db, sqlite } = await createTestDatabase(":memory:");

  try {
    sqlite.exec(
      `UPDATE beatmap_metadata
       SET title = CASE WHEN title = '' THEN 'Existing title' ELSE title END,
           artist = CASE WHEN artist = '' THEN 'Existing artist' ELSE artist END,
           difficulty_name = CASE
             WHEN difficulty_name = '' THEN 'Existing difficulty'
             ELSE difficulty_name
           END,
           mapper = CASE WHEN mapper = '' THEN 'Existing mapper' ELSE mapper END,
           cover_url = CASE
             WHEN cover_url = '' THEN 'https://example.test/existing.jpg'
             ELSE cover_url
           END,
           total_objects = 1`,
    );
    const target = sqlite
      .prepare(
        "SELECT beatmap_id AS beatmapId FROM beatmap_metadata ORDER BY beatmap_id LIMIT 1",
      )
      .get() as { beatmapId: number };
    sqlite
      .prepare(
        `UPDATE beatmap_metadata
         SET title = '', total_objects = NULL
         WHERE beatmap_id = ?`,
      )
      .run(target.beatmapId);

    const requestedIds: number[][] = [];
    const result = await backfillBeatmapMetadata(db, {
      now: () => 1234,
      fetchBatch: async (beatmapIds) => {
        requestedIds.push([...beatmapIds]);
        return new Map([
          [
            target.beatmapId,
            {
              ok: true as const,
              data: {
                metadata: {
                  title: "Song",
                  artist: "Artist",
                  difficultyName: "Insane",
                  mapper: "Mapper",
                  coverUrl: "https://example.test/cover.jpg",
                },
                totalObjects: 500,
              },
            },
          ],
        ]);
      },
    });

    assert.deepEqual(requestedIds, [[target.beatmapId]]);
    assert.deepEqual(result, { requested: 1, updated: 1, failures: [] });
    assert.deepEqual(
      sqlite
        .prepare(
          `SELECT title, artist, difficulty_name AS difficultyName,
                  mapper, cover_url AS coverUrl,
                  total_objects AS totalObjects, fetched_at AS fetchedAt
           FROM beatmap_metadata
           WHERE beatmap_id = ?`,
        )
        .get(target.beatmapId),
      {
        title: "Song",
        artist: "Artist",
        difficultyName: "Insane",
        mapper: "Mapper",
        coverUrl: "https://example.test/cover.jpg",
        totalObjects: 500,
        fetchedAt: 1234,
      },
    );
  } finally {
    sqlite.close();
  }
});
