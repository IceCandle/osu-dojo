import { NextResponse } from "next/server";
import { OriginError, assertSameOrigin } from "@/lib/auth/origin";
import {
  clearSessionCookie,
  getSessionUserFromRequest,
  readCookie,
  revokeSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof OriginError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw error;
  }

  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (await getSessionUserFromRequest(request)) {
    await revokeSession(token);
  }
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}
