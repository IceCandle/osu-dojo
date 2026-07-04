import { redirect } from "next/navigation";
import { SettingsClient } from "@/app/settings/SettingsClient";
import { getUserProfileSettings } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/api/auth/osu/login?return_to=%2Fsettings");
  }

  const settings = await getUserProfileSettings(user.userId);

  return (
    <main className="page-shell settings-page">
      <section className="detail-header settings-header">
        <div>
          <p className="eyebrow">Account settings</p>
          <h1>{user.username}</h1>
          <p className="detail-copy">
            프로필 상세 기록 공개 여부를 관리합니다.
          </p>
        </div>
      </section>
      <SettingsClient
        initialProfileDetailsPublic={settings.profileDetailsPublic}
      />
    </main>
  );
}
