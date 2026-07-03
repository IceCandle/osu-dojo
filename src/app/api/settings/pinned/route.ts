import { privateJson } from "@/app/api/settings/http";
import {
  savePinnedClears,
  SettingsValidationError,
} from "@/db/queries";
import { OriginError, assertSameOrigin } from "@/lib/auth/origin";
import { getSessionUserFromRequest } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof OriginError) {
      return privateJson({ error: "forbidden" }, 403);
    }
    throw error;
  }

  const user = await getSessionUserFromRequest(request);
  if (!user) {
    return privateJson({ error: "unauthorized" }, 401);
  }
  const body = await readBody(request);
  if (!body) {
    return privateJson({ error: "invalid_body" }, 400);
  }

  try {
    return privateJson(await savePinnedClears(user.userId, body));
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return privateJson({ error: "invalid_runs" }, 400);
    }
    throw error;
  }
}

async function readBody(
  request: Request,
): Promise<{ mode: "auto" } | { mode: "manual"; runIds: string[] } | null> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (body["mode"] === "auto" && Object.keys(body).length === 1) {
    return { mode: "auto" };
  }
  if (
    body["mode"] === "manual" &&
    Object.keys(body).length === 2 &&
    Array.isArray(body["runIds"]) &&
    body["runIds"].every((runId) => typeof runId === "string")
  ) {
    return { mode: "manual", runIds: body["runIds"] as string[] };
  }
  return null;
}
