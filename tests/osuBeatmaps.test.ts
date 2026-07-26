import test from "node:test";
import assert from "node:assert/strict";
import { fetchBeatmapMetadataBatch } from "@/lib/osu/beatmaps";
import type { OsuApiClient } from "@/lib/osu/client";

test("beatmap batch requests use chunks of at most 50 ids", async () => {
  const paths: string[] = [];
  const client: OsuApiClient = {
    async requestJson<T>(path: string) {
      paths.push(path);
      const url = new URL(path, "https://osu.ppy.sh");
      const ids = url.searchParams.getAll("ids[]").map(Number);
      return {
        beatmaps: ids.map((id) => ({
          id,
          beatmapset_id: id + 1000,
          version: "Difficulty",
          count_circles: 1,
          count_sliders: 2,
          count_spinners: 3,
          beatmapset: { title: `Title ${id}`, artist: "Artist", creator: "Mapper" },
        })),
      } as T;
    },
  };

  const results = await fetchBeatmapMetadataBatch(
    Array.from({ length: 51 }, (_, index) => index + 1),
    { client },
  );

  assert.equal(paths.length, 2);
  assert.equal(new URL(paths[0]!, "https://osu.ppy.sh").searchParams.getAll("ids[]").length, 50);
  assert.equal(results.size, 51);
});

test("beatmap batch reports ids omitted from an otherwise successful response", async () => {
  const client: OsuApiClient = {
    async requestJson<T>() {
      return { beatmaps: [] } as T;
    },
  };
  const results = await fetchBeatmapMetadataBatch([10, 20], { client });
  const first = results.get(10);
  const second = results.get(20);
  assert.ok(first && !first.ok);
  assert.ok(second && !second.ok);
  assert.match(first.reason, /no metadata/i);
  assert.match(second.reason, /no metadata/i);
});

test("default metadata deadlines renew for each batch chunk", async () => {
  let now = 0;
  const deadlines: number[] = [];
  const client: OsuApiClient = {
    async requestJson<T>(
      path: string,
      options: Parameters<OsuApiClient["requestJson"]>[1],
    ) {
      deadlines.push(options.deadline);
      const url = new URL(path, "https://osu.ppy.sh");
      const ids = url.searchParams.getAll("ids[]").map(Number);
      now += 70_000;
      return { beatmaps: ids.map((id) => ({ id })) } as T;
    },
  };

  await fetchBeatmapMetadataBatch(
    Array.from({ length: 101 }, (_, index) => index + 1),
    { client, now: () => now },
  );

  assert.deepEqual(deadlines, [60_000, 130_000, 200_000]);
});
