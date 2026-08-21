import test from "node:test";
import assert from "node:assert/strict";
import { BanchoClient } from "bancho.js";
import {
  attachBanchoOsuApiAdapter,
  createBanchoOsuApiAdapter,
} from "@/bot/banchoOsuApiAdapter";
import type { OsuApiClient } from "@/lib/osu/client";

function fakeClient(paths: string[] = []): OsuApiClient {
  return {
    async requestJson<T>(path: string) {
      paths.push(path);
      if (path.includes("/users/")) {
        return { id: 42, username: "PlayerOne" } as T;
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
  const paths: string[] = [];
  const adapter = createBanchoOsuApiAdapter({ client: fakeClient(paths), now: () => 0 });
  assert.deepEqual(await adapter.user.get("PlayerOne"), {
    id: 42,
    username: "PlayerOne",
  });
  assert.deepEqual(await adapter.beatmaps.getByBeatmapId(259), [{ id: 259 }]);
  assert.equal(paths.some((path) => path.includes("/beatmaps")), false);
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

test("bancho beatmap lookup is a local shim that never calls HTTP", async () => {
  let requests = 0;
  const adapter = createBanchoOsuApiAdapter({
    client: {
      async requestJson() {
        requests += 1;
        throw new Error("HTTP must not be called");
      },
    },
    now: () => 0,
  });

  assert.deepEqual(await adapter.beatmaps.getByBeatmapId(259), [{ id: 259 }]);
  assert.equal(requests, 0);
});
