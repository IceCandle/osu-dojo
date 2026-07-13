import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { cleanupExpiredAuthRows } from "@/lib/auth/cleanup";
import { assertDummyRequestHost, validateAuthEnv } from "@/lib/auth/env";
import {
  createOauthRandomValue,
  hashOauthValue,
  OAUTH_TTL_SECONDS,
  setNonceCookie,
} from "@/lib/auth/nonce";
import { buildAuthorizeUrl } from "@/lib/auth/osuOAuth";
import { sanitizeReturnTo } from "@/lib/auth/returnTo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = validateAuthEnv();
  try {
    assertDummyRequestHost(request, auth);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const database = await getDatabase();
  const now = Date.now();
  try {
    cleanupExpiredAuthRows(database.$client, now);
  } catch {
    return new NextResponse("Unable to start login.", { status: 500 });
  }

  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("return_to"));
  const state = createOauthRandomValue();
  const nonce = createOauthRandomValue();

  try {
    database.$client
      .prepare(
        `INSERT INTO oauth_states
          (state_hash, nonce_hash, return_to, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        hashOauthValue(state),
        hashOauthValue(nonce),
        returnTo,
        now,
        now + OAUTH_TTL_SECONDS * 1000,
      );
  } catch {
    return new NextResponse("Unable to start login.", { status: 500 });
  }

  const response = NextResponse.redirect(buildAuthorizeUrl(state), 302);
  setNonceCookie(response, nonce);
  return response;
}
