import { redirect } from "next/navigation";
import { LogoutControl } from "@/app/LogoutControl";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/api/auth/osu/login?return_to=%2Fsettings");
  }

  return (
    <main className="page-shell">
      <section className="detail-header settings-header">
        <div>
          <p className="eyebrow">Account settings</p>
          <h1>{user.username}</h1>
          <p className="detail-copy">Signed in with osu!.</p>
        </div>
        <LogoutControl username={user.username} />
      </section>
    </main>
  );
}
