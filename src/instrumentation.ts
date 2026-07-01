export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { validateAuthEnv } = await import("@/lib/auth/env");
    validateAuthEnv();
  }
}
