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
          count_normal: "500",
          count_slider: "200",
          count_spinner: "10",
        },
      ]),
    );
  };

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

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

test("fetchBeatmapMetadata accepts zero object-count fields", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        {
          beatmapset_id: "1234",
          title: "Song title",
          artist: "Artist",
          version: "Insane",
          creator: "Mapper",
          count_normal: "500",
          count_slider: "200",
          count_spinner: "0",
        },
      ]),
    );

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.totalObjects : null, 700);
});

test("fetchBeatmapMetadata allows display metadata without object counts", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
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

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.metadata?.title : null, "Song title");
  assert.equal(result.ok ? result.data.totalObjects : null, null);
});

test("fetchBeatmapMetadata allows object counts without display metadata", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        {
          beatmapset_id: "1234",
          title: "Song title",
          artist: "Artist",
          version: "Insane",
          count_normal: "500",
          count_slider: "200",
          count_spinner: "10",
        },
      ]),
    );

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.deepEqual(result, {
    ok: true,
    data: {
      metadata: null,
      totalObjects: 710,
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

test("fetchBeatmapMetadata accepts zero total objects without display metadata", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        {
          count_normal: "0",
          count_slider: "0",
          count_spinner: "0",
        },
      ]),
    );

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.deepEqual(result, {
    ok: true,
    data: {
      metadata: null,
      totalObjects: 0,
    },
  });
});

test("fetchBeatmapMetadata rejects empty string count fields", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        {
          beatmapset_id: "1234",
          title: "Song title",
          artist: "Artist",
          version: "Insane",
          creator: "Mapper",
          count_normal: "",
          count_slider: "200",
          count_spinner: "10",
        },
      ]),
    );

  const result = await fetchBeatmapMetadata("test-key", 315, fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.totalObjects : null, null);
});
