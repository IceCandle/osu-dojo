import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PinnedClearControl } from "@/app/dan/[systemNameKey]/PinnedClearControl";
import {
  getDanSystemDetailByNameKey,
  getPinnedClearForCourse,
  getRankingForCourse,
} from "@/db/queries";
import { getSessionUser } from "@/lib/auth/session";
import {
  formatConditionCompact,
  formatPercentage,
  formatScoreModel,
  kebabizeName,
} from "@/lib/format";
import { systemCapabilities } from "@/lib/domain";
import { formatVisibleCourseModTokens } from "@/lib/mods";

export const dynamic = "force-dynamic";

export default async function DanSystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemNameKey: string }>;
  searchParams?: Promise<{ course?: string | string[] }>;
}) {
  const { systemNameKey } = await params;
  const detail = await getDanSystemDetailByNameKey(systemNameKey);
  const courses = detail?.courses ?? [];

  if (!detail) {
    notFound();
  }
  const { system } = detail;
  const capabilities = systemCapabilities(system.status);

  if (courses.length === 0) {
    return (
      <main className="page-shell">
        <section className="detail-header dan-overview-header">
          <div className="system-header-grid">
            <div>
              <div className="detail-title-row">
                <h1>{system.name}</h1>
                {capabilities.badge ? (
                  <span className="system-status-pill detail-status-pill">
                    {capabilities.badge}
                  </span>
                ) : null}
              </div>
              <p className="detail-copy">{system.description}</p>
            </div>
          </div>
        </section>

        <section className="empty-card system-empty-card">
          <h2>No courses available</h2>
          <p>
            This dan system exists, but it does not have any playable courses yet.
          </p>
        </section>
      </main>
    );
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedCourseNameKey = Array.isArray(resolvedSearchParams?.course)
    ? resolvedSearchParams?.course[0]
    : resolvedSearchParams?.course;
  const selectedCourse =
    requestedCourseNameKey === undefined
      ? courses[0]!
      : courses.find(
          (course) => kebabizeName(course.name) === kebabizeName(requestedCourseNameKey),
        );

  if (!selectedCourse) {
    notFound();
  }

  const [ranking, sessionUser] = await Promise.all([
    getRankingForCourse(selectedCourse),
    getSessionUser(),
  ]);
  const viewerBestRun = sessionUser
    ? ranking.results.find((result) => result.userId === sessionUser.userId) ??
      null
    : null;
  const pinnedClear = sessionUser
    ? await getPinnedClearForCourse(sessionUser.userId, selectedCourse.id)
    : null;
  const systemNameKeyForLinks = kebabizeName(system.name);
  const command = `!dojo start ${systemNameKeyForLinks} ${kebabizeName(selectedCourse.name)}`;
  const topResults = ranking.results.slice(0, 10);
  const overallRequirement =
    selectedCourse.overallPassConditions.length > 0
      ? selectedCourse.overallPassConditions.map(formatConditionCompact).join(" / ")
      : "Per-map pass only";

  return (
    <main className="page-shell">
      <section className="detail-header dan-overview-header">
        <div className="system-header-grid">
          <div>
            <div className="detail-title-row">
              <h1>{system.name}</h1>
              {capabilities.badge ? (
                <span className="system-status-pill detail-status-pill">
                  {capabilities.badge}
                </span>
              ) : null}
            </div>
            <p className="detail-copy">{system.description}</p>
          </div>
        </div>
        <div className="detail-stats system-score-model">
          <div>
            <span>Score model</span>
            <strong>{formatScoreModel(selectedCourse.scoreModel)}</strong>
          </div>
        </div>
      </section>

      <nav className="course-tab-bar" role="tablist" aria-label="Course selector">
        {courses.map((course) => (
          <Link
            className={`course-tab${course.id === selectedCourse.id ? " is-active" : ""}`}
            href={`/dan/${systemNameKeyForLinks}?course=${kebabizeName(course.name)}`}
            key={course.id}
            role="tab"
            aria-selected={course.id === selectedCourse.id}
          >
            {course.name}
          </Link>
        ))}
      </nav>

      <section className="sequence-card detail-sequence-card">
        <div className="course-overview">
          <h2>{selectedCourse.name}</h2>
          <p className="course-overall-requirement">{overallRequirement}</p>
          <p className="course-command-line">
            <code>{command}</code>
          </p>
          <p className="course-description">{selectedCourse.description}</p>
        </div>

        {sessionUser ? (
          <section className="course-pin-panel" aria-labelledby="course-pin-heading">
            <div>
              <p className="eyebrow">Your best run</p>
              <h2 id="course-pin-heading">Pinned clear</h2>
              <p>
                Pin your best passing run for this course to your player profile.
              </p>
              {viewerBestRun ? (
                <strong className="course-pin-rank">#{viewerBestRun.rank}</strong>
              ) : null}
            </div>
            <PinnedClearControl
              bestRun={
                viewerBestRun
                  ? {
                      id: viewerBestRun.id,
                      status: viewerBestRun.status,
                      metric:
                        selectedCourse.scoreModel === "scorev1"
                          ? formatPercentage(viewerBestRun.summedAccuracy)
                          : new Intl.NumberFormat("en-US").format(
                              Math.round(viewerBestRun.totalScore),
                            ),
                    }
                  : null
              }
              courseName={selectedCourse.name}
              initialPinnedRunId={pinnedClear?.runId ?? null}
            />
          </section>
        ) : null}

        <div className="results-layout">
          <section className="course-beatmap-section">
            <div className="section-heading">
              <h2>Course sequence</h2>
            </div>

            <div className="course-beatmap-stack">
              {selectedCourse.beatmaps.map((beatmap) => {
                const beatmapUrl = `https://osu.ppy.sh/b/${beatmap.beatmapId}`;
                const coverStyle =
                  beatmap.coverUrl.trim() === ""
                    ? undefined
                    : ({
                        "--cover-image": `url("${beatmap.coverUrl}")`,
                      } as React.CSSProperties);

                return (
                  <article className="course-beatmap-card" key={beatmap.id}>
                    <a
                      className={`course-beatmap-visual${
                        beatmap.coverUrl.trim() === "" ? " is-placeholder" : ""
                      }`}
                      href={beatmapUrl}
                      rel="noreferrer"
                      style={coverStyle}
                      target="_blank"
                    >
                      <span className="beatmap-order">
                        {String(beatmap.ordinal).padStart(2, "0")}
                      </span>
                      <div className="course-beatmap-visual-copy">
                        <p className="course-beatmap-song-title">{beatmap.title}</p>
                        <p className="course-beatmap-song-meta">
                          {beatmap.artist} / {beatmap.mapper}
                        </p>
                      </div>
                    </a>

                    <div className="course-beatmap-body">
                      <div className="course-beatmap-heading">
                        <a href={beatmapUrl} rel="noreferrer" target="_blank">
                          <h3 className="difficulty-label">[{beatmap.difficultyName}]</h3>
                        </a>
                        <p className="mod-label">
                          +{formatBeatmapMods(beatmap).map((token) => (
                            <span
                              className={`mod-token mod-token-${token.toLowerCase()}`}
                              key={token}
                            >
                              {token}
                            </span>
                          ))}
                        </p>
                      </div>

                      <div className="course-beatmap-footer">
                        <p className="course-beatmap-condition">
                          {beatmap.passConditions.map(formatConditionCompact).join(" / ")}
                        </p>

                        {beatmap.annotations.length > 0 ? (
                          <div className="annotation-row">
                            {beatmap.annotations.map((annotation) => (
                              <span className="annotation-chip" key={annotation}>
                                {annotation}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="ranking-section">
            <div className="section-heading">
              <h2>Top runs</h2>
            </div>

            {topResults.length > 0 ? (
              <div className="ranking-table-wrap">
                <table className="ranking-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Player</th>
                      <th>
                        {selectedCourse.scoreModel === "scorev1"
                          ? "Course Acc"
                          : "Adjusted Score Total"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topResults.map((result) => (
                      <RankingRow
                        highlighted={result.userId === sessionUser?.userId}
                        key={result.id}
                        result={result}
                        scoreModel={selectedCourse.scoreModel}
                      />
                    ))}
                  </tbody>
                  {viewerBestRun && viewerBestRun.rank > 10 ? (
                    <tbody className="ranking-personal-body">
                      <RankingRow
                        highlighted
                        result={viewerBestRun}
                        scoreModel={selectedCourse.scoreModel}
                      />
                    </tbody>
                  ) : null}
                </table>
              </div>
            ) : (
              <article className="empty-card compact-empty-card">
                <h2>No runs saved yet</h2>
                {capabilities.persistRuns ? (
                  <p>
                    Start the bot with <code>{command}</code> and the next completed
                    course will appear here.
                  </p>
                ) : (
                  <p>Runs on draft systems are not recorded.</p>
                )}
              </article>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function formatBeatmapMods(beatmap: { mods: string; freemod: boolean }): string[] {
  if (beatmap.freemod) {
    return ["FM"];
  }

  const tokens = formatVisibleCourseModTokens(beatmap.mods);
  return tokens.length === 0 ? ["NM"] : tokens;
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

type CourseRankingResult = Awaited<ReturnType<typeof getRankingForCourse>>["results"][number];

function RankingRow({
  highlighted,
  result,
  scoreModel,
}: {
  highlighted: boolean;
  result: CourseRankingResult;
  scoreModel: "scorev1" | "scorev2";
}) {
  const metricValue =
    scoreModel === "scorev1"
      ? formatPercentage(result.summedAccuracy)
      : new Intl.NumberFormat("en-US").format(Math.round(result.totalScore));
  const matchUrl = result.matchId ? `https://osu.ppy.sh/mp/${result.matchId}` : null;

  return (
    <tr className={highlighted ? "ranking-row-you" : undefined}>
      <td className={`ranking-rank-cell ${getRunStatusClassName(result.status)}`}>
        {result.rank}
      </td>
      <td>
        <Link className="ranking-player-link" href={`/players/${result.userId}`}>
          <strong className="ranking-player-name">{result.username}</strong>
        </Link>
      </td>
      <td className="numeric-cell">
        <div className="ranking-metric-cell">
          {matchUrl ? (
            <a className="ranking-metric-link" href={matchUrl} rel="noreferrer" target="_blank">
              {metricValue}
            </a>
          ) : (
            <span>{metricValue}</span>
          )}
        </div>
      </td>
    </tr>
  );
}
