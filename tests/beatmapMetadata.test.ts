import test from "node:test";
import assert from "node:assert/strict";
import { fetchBeatmapMetadata } from "@/lib/beatmapMetadata";

test("fetchBeatmapMetadata normalizes osu API metadata", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    assert.match(String(input), /api\/get_beatmaps/);
    assert.match(String(input), /b=315/);
    assert.match(String(input), /k=test-key/);

    return new Response(
      JSON.stringify([
        {
          beatmapset_id: "1234",
          title: "Song title",
          artist: "Artist",
          version: "Insane",
          creator: "Mapper",
        },
      ]),
    );
  };

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.deepEqual(result, {
    ok: true,
    data: {
      title: "Song title",
      artist: "Artist",
      difficultyName: "Insane",
      mapper: "Mapper",
      coverUrl: "https://assets.ppy.sh/beatmaps/1234/covers/cover.jpg",
    },
  });
});

test("fetchBeatmapMetadata reports empty osu API responses", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify([]));

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /no metadata/i);
});

test("fetchBeatmapMetadata reports HTTP failures", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("rate limited", { status: 429 });

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /429/);
});

test("fetchBeatmapMetadata reports malformed osu API records", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        {
          beatmapset_id: "",
          title: "Song title",
          artist: "Artist",
          version: "Insane",
          creator: "Mapper",
        },
      ]),
    );

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /incomplete/i);
});
