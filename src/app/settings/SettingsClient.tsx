"use client";

import { useEffect, useState } from "react";

interface SettingsClientProps {
  initialProfileDetailsPublic: boolean;
}

export function SettingsClient({
  initialProfileDetailsPublic,
}: SettingsClientProps) {
  const [profileDetailsPublic, setProfileDetailsPublic] = useState(
    initialProfileDetailsPublic,
  );
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  async function updateVisibility(nextValue: boolean) {
    const previous = profileDetailsPublic;
    setProfileDetailsPublic(nextValue);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileDetailsPublic: nextValue }),
      });
      if (!response.ok) {
        throw new Error();
      }
      setNotice("Saved visibility settings.");
    } catch {
      setProfileDetailsPublic(previous);
      setNotice("Couldn't save visibility settings.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-grid" data-ready={ready ? "true" : undefined}>
      <section className="sequence-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Visibility</p>
            <h2>Profile details</h2>
          </div>
        </div>
        <label className="settings-toggle">
          <input
            checked={profileDetailsPublic}
            disabled={pending}
            onChange={(event) => void updateVisibility(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Show detailed profile history</strong>
            <small>
              Turn this off to hide recent runs, scores, and pinned clears from other users.
            </small>
          </span>
        </label>
      </section>

      {notice ? (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
