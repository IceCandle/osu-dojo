import React from "react";
import { notFound } from "next/navigation";
import { LocalTime } from "@/app/LocalTime";
import { getPlayerProfile } from "@/db/queries";
import type { PinnedClearView, PlayerRecentRun } from "@/lib/domain";
import { formatPercentage } from "@/lib/format";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MODE_TABS = ["osu", "taiko", "catch", "mania"] as const;
const SUPPORTED_MODE = "osu";

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

  const sessionUser = await getSessionUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedMode = Array.isArray(resolvedSearchParams?.mode)
    ? resolvedSearchParams?.mode[0]
    : resolvedSearchParams?.mode;
  const selectedMode = resolveSelectedMode(requestedMode);
  const profile = await getPlayerProfile(userId, {
    viewerUserId: sessionUser?.userId ?? null,
  });

  if (!profile) {
    notFound();
  }

  return (
    <main className="page-shell">
      <section className="detail-header player-header">
        <a
          aria-label={`${profile.username}'s osu! profile`}
          className="player-avatar-link"
          href={profile.osuProfileUrl}
          rel="noreferrer"
          target="_blank"
        >
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
        {profile.detailsVisible ? (
          <div className="detail-stats player-header-stats">
            <div>
              <span>Play count</span>
              <strong>{profile.playCount}</strong>
            </div>
          </div>
        ) : null}
      </section>

      <ModeTabs selectedMode={selectedMode} />

      <div className="player-profile-grid">
        <section className="sequence-card player-profile-section">
          <SectionHeading title="Highest official dan" />
          {profile.highestOfficialDans.length > 0 ? (
            <div className="player-badge-list">
              {profile.highestOfficialDans.map((badge) => (
                <article className="player-badge-card" key={`${badge.ladderKey}-${badge.courseId}`}>
                  <span className="player-dan-badge">{badge.label}</span>
                  <p>{badge.systemName}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        {profile.detailsVisible ? (
          <>
            <section className="sequence-card player-profile-section">
              <SectionHeading count={profile.pinnedClears.length} title="Pinned clears" />
              {profile.pinnedClears.length > 0 ? (
                <div className="player-clear-list">
                  {profile.pinnedClears.map((clear) => (
                    <article className="player-clear-card" key={clear.runId}>
                      <div>
                        <h3>{clear.courseLabel ?? clear.courseName}</h3>
                        <p>{clear.systemName}</p>
                      </div>
                      <div className="player-clear-meta">
                        <strong>{formatPinnedMetric(clear)}</strong>
                        <LocalTime
                          value={clear.completedAt}
                          ssrFallback={formatDate(clear.completedAt)}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="sequence-card player-profile-section">
              <SectionHeading count={profile.recentRuns.length} title="Recent runs" />
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
              ) : null}
            </section>

            <section className="sequence-card player-profile-section">
              <SectionHeading count={profile.mostPlayedCourses.length} title="Most played courses" />
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
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function ModeTabs({ selectedMode }: { selectedMode: string }) {
  return (
    <nav className="course-tab-bar player-mode-tabs" role="tablist" aria-label="Game mode selector">
      {MODE_TABS.map((mode) => (
        <button
          aria-selected={mode === selectedMode}
          className={`course-tab${mode === selectedMode ? " is-active" : ""}${
            mode !== "osu" ? " is-disabled" : ""
          }`}
          disabled={mode !== "osu"}
          key={mode}
          role="tab"
          type="button"
        >
          {mode}
        </button>
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
      <td>
        <LocalTime value={run.completedAt} ssrFallback={formatDate(run.completedAt)} />
      </td>
    </tr>
  );
}

function SectionHeading({ count, title }: { count?: number; title: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {count === undefined ? null : (
        <span aria-label={`${count} items`} className="player-section-count">
          {count}
        </span>
      )}
    </div>
  );
}

function parseUserId(value: string) {
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveSelectedMode(requestedMode: string | undefined) {
  return requestedMode === SUPPORTED_MODE ? requestedMode : SUPPORTED_MODE;
}

function formatPinnedMetric(clear: PinnedClearView) {
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
