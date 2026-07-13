import { NextResponse } from "next/server";
import { assertDummyRequestHost, validateAuthEnv } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const auth = validateAuthEnv();
  if (!auth.dummyAuth) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    assertDummyRequestHost(request, auth);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const state = new URL(request.url).searchParams.get("state");
  if (!state) {
    return new NextResponse("Missing state.", { status: 400 });
  }
  const callback = new URL(auth.callbackUrl);
  callback.searchParams.set("code", "dummy-code");
  callback.searchParams.set("state", state);
  return NextResponse.redirect(callback, 302);
}
