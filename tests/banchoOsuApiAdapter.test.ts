import test from "node:test";
import assert from "node:assert/strict";
import { BanchoClient } from "bancho.js";
import {
  attachBanchoOsuApiAdapter,
  createBanchoOsuApiAdapter,
} from "@/bot/banchoOsuApiAdapter";
import {
  FetchTransportError,
  type OsuApiClient,
} from "@/lib/osu/client";

function fakeClient(): OsuApiClient {
  return {
    async requestJson<T>(path: string) {
      if (path.includes("/users/")) {
        return { id: 42, username: "PlayerOne" } as T;
      }
      if (path.includes("/beatmaps?")) {
        return {
          beatmaps: [
            {
              id: 259,
              beatmapset_id: 1000,
              version: "Insane",
              count_circles: 1,
              count_sliders: 1,
              count_spinners: 0,
              beatmapset: { title: "Song", artist: "Artist", creator: "Mapper" },
            },
          ],
        } as T;
      }
      return {
        match: { id: 123 },
        first_event_id: 1,
        latest_event_id: 1,
        events: [],
      } as T;
    },
  };
}

test("bancho adapter implements the three nodesu surfaces used by bancho.js", async () => {
  const adapter = createBanchoOsuApiAdapter({ client: fakeClient(), now: () => 0 });
  assert.deepEqual(await adapter.user.get("PlayerOne"), {
    id: 42,
    username: "PlayerOne",
  });
  assert.deepEqual(await adapter.beatmaps.getByBeatmapId(259), [{ id: 259 }]);
  assert.deepEqual(await adapter.multi.getMatch(123), {
    match: { id: 123 },
    first_event_id: 1,
    latest_event_id: 1,
    events: [],
  });
  assert.throws(
    () => (adapter as unknown as Record<string, unknown>)["scores"],
    /unsupported/i,
  );
});

test("attaching the adapter promotes #mp channels without an API key", () => {
  const client = new BanchoClient({ username: "bot", password: "password" });
  attachBanchoOsuApiAdapter(
    client,
    createBanchoOsuApiAdapter({ client: fakeClient(), now: () => 0 }),
  );
  assert.equal(client.getChannel("#mp_123").constructor.name, "BanchoMultiplayerChannel");
});

test("bancho beatmap lookup preserves transport failures", async () => {
  const adapter = createBanchoOsuApiAdapter({
    client: {
      async requestJson() {
        throw new FetchTransportError("temporary failure", true);
      },
    },
    now: () => 0,
  });

  await assert.rejects(
    adapter.beatmaps.getByBeatmapId(259),
    /temporary failure/,
  );
});
