import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextResponse } from "next/server";
import { validateAuthEnv } from "@/lib/auth/env";
import { readCookie } from "@/lib/auth/session";

export const OAUTH_NONCE_COOKIE_NAME = "dojo_oauth_nonce";
export const OAUTH_TTL_SECONDS = 10 * 60;
const RANDOM_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createOauthRandomValue() {
  return randomBytes(32).toString("base64url");
}

export function hashOauthValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function signNonce(nonce: string) {
  const signature = createHmac("sha256", validateAuthEnv().sessionSecret)
    .update(nonce)
    .digest("base64url");
  return `${nonce}.${signature}`;
}

export function verifyNonceCookie(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const [nonce, signature, extra] = value.split(".");
  if (
    extra !== undefined ||
    !nonce ||
    !signature ||
    !RANDOM_VALUE_PATTERN.test(nonce) ||
    !RANDOM_VALUE_PATTERN.test(signature)
  ) {
    return null;
  }

  const expected = createHmac("sha256", validateAuthEnv().sessionSecret)
    .update(nonce)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  return nonce;
}

export function readVerifiedNonce(request: Request) {
  return verifyNonceCookie(readCookie(request, OAUTH_NONCE_COOKIE_NAME));
}

export function setNonceCookie(response: NextResponse, nonce: string) {
  const auth = validateAuthEnv();
  response.cookies.set(OAUTH_NONCE_COOKIE_NAME, signNonce(nonce), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_TTL_SECONDS,
    secure: auth.secureCookies,
  });
}

export function clearNonceCookie(response: NextResponse) {
  const auth = validateAuthEnv();
  response.cookies.set(OAUTH_NONCE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: auth.secureCookies,
  });
}
