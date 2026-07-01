import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { assertDummyRequestHost, validateAuthEnv } from "@/lib/auth/env";
import {
  clearNonceCookie,
  hashOauthValue,
  readVerifiedNonce,
} from "@/lib/auth/nonce";
import {
  exchangeCodeForToken,
  fetchOsuUser,
  OAuthProviderError,
} from "@/lib/auth/osuOAuth";
import { createSession, setSessionCookie } from "@/lib/auth/session";

export async function GET(request: Request) {
  const auth = validateAuthEnv();
  try {
    assertDummyRequestHost(request, auth);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const nonce = readVerifiedNonce(request);
  if (!state || !nonce) {
    return withClearedNonce(new NextResponse("Invalid OAuth callback.", { status: 400 }));
  }

  const database = await getDatabase();
  const consumed = database.$client
    .prepare(
      `UPDATE oauth_states
       SET consumed_at = ?
       WHERE state_hash = ?
         AND nonce_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?
       RETURNING return_to AS returnTo`,
    )
    .get(
      Date.now(),
      hashOauthValue(state),
      hashOauthValue(nonce),
      Date.now(),
    ) as { returnTo: string | null } | undefined;
  if (!consumed) {
    return withClearedNonce(new NextResponse("Invalid OAuth callback.", { status: 400 }));
  }

  if (url.searchParams.has("error")) {
    return withClearedNonce(NextResponse.redirect(new URL("/", auth.siteOrigin), 302));
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return withClearedNonce(new NextResponse("Missing authorization code.", { status: 400 }));
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const user = await fetchOsuUser(accessToken);
    const now = Date.now();
    database.$client
      .prepare(
        `INSERT INTO users (osu_user_id, username, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(osu_user_id) DO UPDATE SET
           username = excluded.username,
           updated_at = excluded.updated_at`,
      )
      .run(user.id, user.username, now, now);
    const sessionToken = await createSession(user.id, database, now);
    const response = NextResponse.redirect(
      new URL(consumed.returnTo ?? "/", auth.siteOrigin),
      302,
    );
    setSessionCookie(response, sessionToken);
    return withClearedNonce(response);
  } catch (error) {
    console.error("OAuth callback failed.", {
      category: error instanceof OAuthProviderError ? "provider" : "internal",
    });
    return withClearedNonce(new NextResponse("Login provider unavailable.", { status: 502 }));
  }
}

function withClearedNonce(response: NextResponse) {
  clearNonceCookie(response);
  return response;
}
