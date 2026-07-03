import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getDatabase, type AppDatabase } from "@/db/client";
import { validateAuthEnv } from "@/lib/auth/env";

export const SESSION_COOKIE_NAME = "dojo_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionUser {
  userId: number;
  username: string;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: number,
  db?: AppDatabase,
  now = Date.now(),
) {
  const database = db ?? (await getDatabase());
  const token = randomBytes(32).toString("base64url");
  database.$client
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(hashToken(token), userId, now, now + SESSION_TTL_SECONDS * 1000);
  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    return getSessionUserFromToken(cookies().get(SESSION_COOKIE_NAME)?.value);
  } catch {
    return null;
  }
}

export async function getSessionUserFromRequest(
  request: Request,
  db?: AppDatabase,
  now = Date.now(),
) {
  return getSessionUserFromToken(readCookie(request, SESSION_COOKIE_NAME), db, now);
}

export async function getSessionUserFromToken(
  token: string | null | undefined,
  db?: AppDatabase,
  now = Date.now(),
): Promise<SessionUser | null> {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const database = db ?? (await getDatabase());
  const row = database.$client
    .prepare(
      `SELECT s.user_id AS userId, u.username
       FROM sessions s
       INNER JOIN users u ON u.osu_user_id = s.user_id
       WHERE s.token_hash = ?
         AND s.expires_at > ?
         AND s.revoked_at IS NULL
       LIMIT 1`,
    )
    .get(hashToken(token), now) as SessionUser | undefined;
  return row ?? null;
}

export async function revokeSession(
  token: string | null | undefined,
  db?: AppDatabase,
  now = Date.now(),
) {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) {
    return false;
  }

  const database = db ?? (await getDatabase());
  const result = database.$client
    .prepare(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE token_hash = ?`,
    )
    .run(now, hashToken(token));
  return result.changes > 0;
}

export function setSessionCookie(response: NextResponse, token: string) {
  const auth = validateAuthEnv();
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: auth.secureCookies,
  });
}

export function clearSessionCookie(response: NextResponse) {
  const auth = validateAuthEnv();
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: auth.secureCookies,
  });
}

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}
