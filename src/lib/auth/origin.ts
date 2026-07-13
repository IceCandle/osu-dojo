import { validateAuthEnv } from "@/lib/auth/env";

export class OriginError extends Error {
  constructor() {
    super("Request origin is not allowed.");
    this.name = "OriginError";
  }
}

export function assertSameOrigin(request: Request) {
  const header = request.headers.get("origin");
  if (!header) {
    throw new OriginError();
  }

  let origin: string;
  try {
    origin = new URL(header).origin;
  } catch {
    throw new OriginError();
  }

  if (origin !== header || origin !== validateAuthEnv().siteOrigin) {
    throw new OriginError();
  }
}
