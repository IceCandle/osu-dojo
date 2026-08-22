import test from "node:test";
import assert from "node:assert/strict";
import { fetchBeatmapMetadataV2 } from "@/lib/osu/beatmaps";
import type { OsuApiClient } from "@/lib/osu/client";

function clientFor(payload: unknown, inspectPath?: (path: string) => void): OsuApiClient {
  return {
    async requestJson<T>(path: string) {
      inspectPath?.(path);
      return payload as T;
    },
  };
}

function beatmap(overrides: Record<string, unknown> = {}) {
  return {
    id: 315,
    beatmapset_id: 1234,
    version: "Insane",
    count_circles: 500,
    count_sliders: 200,
    count_spinners: 10,
    beatmapset: {
      title: "Song title",
      artist: "Artist",
      creator: "Mapper",
    },
    ...overrides,
  };
}

test("fetchBeatmapMetadataV2 preserves the metadata contract", async () => {
  const result = await fetchBeatmapMetadataV2(315, {
    client: clientFor({ beatmaps: [beatmap()] }, (path) => {
      assert.match(path, /api\/v2\/beatmaps/);
      assert.match(path, /ids%5B%5D=315/);
    }),
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      metadata: {
        title: "Song title",
        artist: "Artist",
        difficultyName: "Insane",
        mapper: "Mapper",
        coverUrl: "https://assets.ppy.sh/beatmaps/1234/covers/cover.jpg",
      },
      totalObjects: 710,
    },
  });
});

test("fetchBeatmapMetadataV2 accepts zero object-count fields", async () => {
  const result = await fetchBeatmapMetadataV2(315, {
    client: clientFor({
      beatmaps: [beatmap({ count_spinners: 0 })],
    }),
  });
  assert.equal(result.ok ? result.data.totalObjects : null, 700);
});

test("fetchBeatmapMetadataV2 allows display metadata without object counts", async () => {
  const result = await fetchBeatmapMetadataV2(315, {
    client: clientFor({
      beatmaps: [
        beatmap({
          count_circles: null,
          count_sliders: null,
          count_spinners: null,
        }),
      ],
    }),
  });
  assert.equal(result.ok ? result.data.metadata?.title : null, "Song title");
  assert.equal(result.ok ? result.data.totalObjects : 0, null);
});

test("fetchBeatmapMetadataV2 allows object counts without display metadata", async () => {
  const result = await fetchBeatmapMetadataV2(315, {
    client: clientFor({ beatmaps: [beatmap({ beatmapset: null })] }),
  });
  assert.deepEqual(result, {
    ok: true,
    data: { metadata: null, totalObjects: 710 },
  });
});

test("fetchBeatmapMetadataV2 reports absent and malformed records", async () => {
  const absent = await fetchBeatmapMetadataV2(315, {
    client: clientFor({ beatmaps: [] }),
  });
  const malformed = await fetchBeatmapMetadataV2(315, {
    client: clientFor({ beatmaps: [beatmap({ beatmapset_id: null })] }),
  });
  assert.match(absent.ok ? "" : absent.reason, /no metadata/i);
  assert.equal(malformed.ok, true);
  assert.equal(malformed.ok ? malformed.data.metadata : {}, null);
});
