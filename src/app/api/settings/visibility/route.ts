import { setProfileDetailsPublic } from "@/db/queries";
import { privateJson } from "@/app/api/settings/http";
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

  const body = await readJson(request);
  if (
    !body ||
    typeof body["profileDetailsPublic"] !== "boolean" ||
    Object.keys(body).length !== 1
  ) {
    return privateJson({ error: "invalid_body" }, 400);
  }
  const profileDetailsPublic = await setProfileDetailsPublic(
    user.userId,
    body["profileDetailsPublic"],
  );
  return privateJson({ profileDetailsPublic });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
