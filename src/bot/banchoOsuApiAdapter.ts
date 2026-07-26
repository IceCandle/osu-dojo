import type { BanchoClient } from "bancho.js";
import {
  fetchBeatmapMetadataBatch,
} from "@/lib/osu/beatmaps";
import {
  fetchMatchEventWindow,
} from "@/lib/osu/matches";
import {
  getDefaultOsuApiClient,
  type OsuApiClient,
} from "@/lib/osu/client";
import { fetchOsuPublicUser } from "@/lib/osu/users";

const ADAPTER_DEADLINE_MS = 30_000;
const ADAPTER_CALL_TIMEOUT_MS = 10_000;

interface BanchoOsuApiAdapter {
  user: {
    get(
      user: string | number,
      mode?: unknown,
      eventDays?: unknown,
      lookupType?: string,
    ): Promise<{ id: number; username: string }>;
  };
  beatmaps: {
    getByBeatmapId(beatmapId: number): Promise<Array<{ id: number }>>;
  };
  multi: {
    getMatch(matchId: number): Promise<unknown>;
  };
}

export function createBanchoOsuApiAdapter(
  options: {
    client?: OsuApiClient;
    now?: () => number;
  } = {},
): BanchoOsuApiAdapter {
  const client = options.client ?? getDefaultOsuApiClient();
  const now = options.now ?? Date.now;

  return strictSurface("osuApi", {
    user: strictSurface("osuApi.user", {
      async get(
        user: string | number,
        _mode?: unknown,
        _eventDays?: unknown,
        _lookupType?: string,
      ) {
        return fetchOsuPublicUser(user, {
          client,
          deadline: now() + ADAPTER_DEADLINE_MS,
          perCallTimeoutMs: ADAPTER_CALL_TIMEOUT_MS,
          now,
        });
      },
    }),
    beatmaps: strictSurface("osuApi.beatmaps", {
      async getByBeatmapId(beatmapId: number) {
        const results = await fetchBeatmapMetadataBatch([beatmapId], {
          client,
          deadline: now() + ADAPTER_DEADLINE_MS,
          perCallTimeoutMs: ADAPTER_CALL_TIMEOUT_MS,
          rateLimit: "runCritical",
          now,
          throwOnRequestError: true,
        });
        const result = results.get(beatmapId);
        return result?.ok ? [{ id: beatmapId }] : [];
      },
    }),
    multi: strictSurface("osuApi.multi", {
      async getMatch(matchId: number) {
        const window = await fetchMatchEventWindow(client, matchId, {
          deadline: now() + ADAPTER_DEADLINE_MS,
          perCallTimeoutMs: ADAPTER_CALL_TIMEOUT_MS,
        });
        return window.raw;
      },
    }),
  });
}

export function attachBanchoOsuApiAdapter(
  client: BanchoClient,
  adapter = createBanchoOsuApiAdapter(),
) {
  (client as unknown as { osuApi: BanchoOsuApiAdapter }).osuApi = adapter;
  return client;
}

function strictSurface<T extends object>(name: string, value: T): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (
        typeof property === "string" &&
        !Reflect.has(target, property)
      ) {
        throw new Error(`Unsupported bancho.js ${name}.${property} call.`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}
