import {
  getDefaultOsuApiClient,
  type OsuApiClient,
} from "@/lib/osu/client";

const DEFAULT_DEADLINE_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export interface OsuPublicUser {
  id: number;
  username: string;
}

export async function fetchOsuPublicUser(
  user: string | number,
  options: {
    client?: OsuApiClient;
    deadline?: number;
    perCallTimeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<OsuPublicUser> {
  const now = options.now ?? Date.now;
  const client = options.client ?? getDefaultOsuApiClient();
  const key = typeof user === "number" ? "id" : "username";
  const payload = await client.requestJson<unknown>(
    `/api/v2/users/${encodeURIComponent(String(user))}/osu?key=${key}`,
    {
      rateLimit: "runCritical",
      deadline: options.deadline ?? now() + DEFAULT_DEADLINE_MS,
      perCallTimeoutMs: options.perCallTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    },
  );

  if (
    !isRecord(payload) ||
    typeof payload["id"] !== "number" ||
    !Number.isSafeInteger(payload["id"]) ||
    payload["id"] <= 0 ||
    typeof payload["username"] !== "string" ||
    payload["username"].trim() === ""
  ) {
    throw new Error("osu! API returned an invalid user.");
  }

  return {
    id: payload["id"],
    username: payload["username"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
