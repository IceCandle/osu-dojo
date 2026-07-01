import { validateAuthEnv } from "@/lib/auth/env";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function sanitizeReturnTo(value: string | null | undefined) {
  if (
    !value ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    value.includes("\\") ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return "/";
  }

  try {
    const auth = validateAuthEnv();
    const resolved = new URL(value, auth.siteOrigin);
    if (resolved.origin !== auth.siteOrigin) {
      return "/";
    }
  } catch {
    return "/";
  }

  return value;
}
