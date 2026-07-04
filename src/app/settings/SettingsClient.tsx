"use client";

import { useState } from "react";

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
      setNotice("공개 설정을 저장했습니다.");
    } catch {
      setProfileDetailsPublic(previous);
      setNotice("공개 설정을 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-grid">
      <section className="sequence-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Visibility</p>
            <h2>프로필 상세 기록</h2>
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
            <strong>프로필 상세 기록 공개</strong>
            <small>
              끄면 다른 사용자에게 최근 run, 점수, 대표 클리어를 숨깁니다.
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
