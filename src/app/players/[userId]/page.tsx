import React from "react";
import { notFound } from "next/navigation";
import { getPlayerProfile } from "@/db/queries";
import type { PlayerPinnedClear, PlayerRecentRun } from "@/lib/domain";
import { formatPercentage } from "@/lib/format";

export const dynamic = "force-dynamic";

const MODE_TABS = ["osu", "taiko", "catch", "mania"] as const;

export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ mode?: string | string[] }>;
}) {
  const { userId: rawUserId } = await params;
  const userId = parseUserId(rawUserId);
  if (userId === null) {
    notFound();
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedMode = Array.isArray(resolvedSearchParams?.mode)
    ? resolvedSearchParams?.mode[0]
    : resolvedSearchParams?.mode;
  const selectedMode = requestedMode === "osu" || !requestedMode ? "osu" : requestedMode;
  const profile = await getPlayerProfile(userId);
  const avatarUrl = profile?.avatarUrl ?? `https://a.ppy.sh/${userId}`;
  const osuProfileUrl = profile?.osuProfileUrl ?? `https://osu.ppy.sh/users/${userId}`;

  if (!profile) {
    return (
      <main className="page-shell">
        <section className="detail-header player-header">
          <a className="player-avatar-link" href={osuProfileUrl} rel="noreferrer" target="_blank">
            <img alt="" className="player-avatar" src={avatarUrl} />
          </a>
          <div className="player-header-copy">
            <p className="eyebrow">Player</p>
            <h1>User {userId}</h1>
            <p className="detail-copy">No local dan runs have been saved for this player.</p>
          </div>
        </section>
        <ModeTabs selectedMode={selectedMode} />
        <section className="empty-card player-empty-card">
          <h2>No saved runs</h2>
          <p>This page only uses osu!dojo runs stored in the local database.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="detail-header player-header">
        <a className="player-avatar-link" href={profile.osuProfileUrl} rel="noreferrer" target="_blank">
          <img alt="" className="player-avatar" src={profile.avatarUrl} />
        </a>
        <div className="player-header-copy">
          <p className="eyebrow">Player</p>
          <div className="player-title-row">
            <a href={profile.osuProfileUrl} rel="noreferrer" target="_blank">
              <h1>{profile.username}</h1>
            </a>
            <div className="player-dan-badges" aria-label="Acquired dan badges">
              {profile.highestOfficialDans.map((badge) => (
                <span className="player-dan-badge" key={`${badge.ladderKey}-${badge.courseId}`}>
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
          <p className="detail-copy">Read-only profile from saved osu!dojo dan runs.</p>
        </div>
        <div className="detail-stats player-header-stats">
          <div>
            <span>Play count</span>
            <strong>{profile.playCount}</strong>
          </div>
        </div>
      </section>

      <ModeTabs selectedMode={selectedMode} />

      <div className="player-profile-grid">
        <section className="sequence-card player-profile-section">
          <div className="section-heading">
            <h2>Highest official dan</h2>
          </div>
          {profile.highestOfficialDans.length > 0 ? (
            <div className="player-badge-list">
              {profile.highestOfficialDans.map((badge) => (
                <article className="player-badge-card" key={`${badge.ladderKey}-${badge.courseId}`}>
                  <span className="player-dan-badge">{badge.label}</span>
                  <p>{badge.systemName}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel title="No official dan yet" body="Passed official courses will appear here." />
          )}
        </section>

        <section className="sequence-card player-profile-section">
          <div className="section-heading">
            <h2>Pinned clears</h2>
          </div>
          {profile.pinnedClears.length > 0 ? (
            <div className="player-clear-list">
              {profile.pinnedClears.map((clear) => (
                <article className="player-clear-card" key={clear.runId}>
                  <div>
                    <h3>{clear.courseLabel ?? clear.courseName}</h3>
                    <p>{clear.systemName}</p>
                  </div>
                  <div className="player-clear-meta">
                    <span className={getRunStatusClassName(clear.status)}>{clear.status}</span>
                    <strong>#{clear.rank}</strong>
                    <span>{formatPinnedMetric(clear)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel title="No pinned clears" body="Passing runs are selected automatically." />
          )}
        </section>

        <section className="sequence-card player-profile-section">
          <div className="section-heading">
            <h2>Recent runs</h2>
          </div>
          {profile.recentRuns.length > 0 ? (
            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Status</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recentRuns.map((run) => (
                    <RecentRunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No recent runs" body="Completed local runs will appear here." />
          )}
        </section>

        <section className="sequence-card player-profile-section">
          <div className="section-heading">
            <h2>Most played courses</h2>
          </div>
          {profile.mostPlayedCourses.length > 0 ? (
            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>System</th>
                    <th>Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.mostPlayedCourses.map((course) => (
                    <tr key={course.courseId}>
                      <td>{course.courseLabel ?? course.courseName}</td>
                      <td>{course.systemName}</td>
                      <td className="numeric-cell">{course.playCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No course history" body="Course counts are calculated from saved runs." />
          )}
        </section>
      </div>
    </main>
  );
}

function ModeTabs({ selectedMode }: { selectedMode: string }) {
  return (
    <nav className="course-tab-bar player-mode-tabs" aria-label="Game mode selector">
      {MODE_TABS.map((mode) => (
        <span
          aria-disabled={mode !== "osu"}
          aria-selected={mode === selectedMode}
          className={`course-tab${mode === selectedMode ? " is-active" : ""}${
            mode !== "osu" ? " is-disabled" : ""
          }`}
          key={mode}
          role="tab"
        >
          {mode}
        </span>
      ))}
    </nav>
  );
}

function RecentRunRow({ run }: { run: PlayerRecentRun }) {
  return (
    <tr>
      <td>
        <strong className="ranking-player-name">{run.courseLabel ?? run.courseName}</strong>
      </td>
      <td className={getRunStatusClassName(run.status)}>{run.status}</td>
      <td>{formatDate(run.completedAt)}</td>
    </tr>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <article className="empty-card compact-empty-card">
      <h2>{title}</h2>
      <p>{body}</p>
    </article>
  );
}

function parseUserId(value: string) {
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatPinnedMetric(clear: PlayerPinnedClear) {
  if (clear.scoreModel === "scorev1") {
    return formatPercentage(clear.summedAccuracy);
  }

  return new Intl.NumberFormat("en-US").format(Math.round(clear.totalScore));
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function getRunStatusClassName(status: "pass" | "fail" | "dnf") {
  if (status === "pass") {
    return "status-pass";
  }

  if (status === "fail") {
    return "status-fail";
  }

  return "status-dnf";
}
