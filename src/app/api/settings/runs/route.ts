import { privateJson } from "@/app/api/settings/http";
import { getRunPickerPage, SettingsValidationError } from "@/db/queries";
import { getSessionUserFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getSessionUserFromRequest(request);
  if (!user) {
    return privateJson({ error: "unauthorized" }, 401);
  }

  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return privateJson(await getRunPickerPage(user.userId, cursor));
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return privateJson({ error: "invalid_cursor" }, 400);
    }
    throw error;
  }
}
