import { privateJson } from "@/app/api/settings/http";
import {
  PinLimitError,
  SettingsValidationError,
  updatePinnedClear,
} from "@/db/queries";
import { OriginError, assertSameOrigin } from "@/lib/auth/origin";
import { getSessionUserFromRequest } from "@/lib/auth/session";

export async function POST(request: Request) {
  const user = await getSessionUserFromRequest(request);
  if (!user) {
    return privateJson({ error: "unauthorized" }, 401);
  }

  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof OriginError) {
      return privateJson({ error: "forbidden" }, 403);
    }
    throw error;
  }

  const body = await readBody(request);
  if (!body) {
    return privateJson({ error: "invalid_body" }, 400);
  }

  try {
    return privateJson(await updatePinnedClear(user.userId, body));
  } catch (error) {
    if (error instanceof PinLimitError) {
      return privateJson({ error: "pin_limit" }, 409);
    }
    if (error instanceof SettingsValidationError) {
      return privateJson({ error: "invalid_run" }, 400);
    }
    throw error;
  }
}

async function readBody(
  request: Request,
): Promise<{ runId: string; pinned: boolean } | null> {
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
  if (
    Object.keys(body).length === 2 &&
    typeof body["runId"] === "string" &&
    body["runId"].length > 0 &&
    typeof body["pinned"] === "boolean"
  ) {
    return { runId: body["runId"], pinned: body["pinned"] };
  }
  return null;
}
