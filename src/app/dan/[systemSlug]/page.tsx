import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRankingForCourse, listDanCoursesBySystemSlug } from "@/db/queries";
import {
  formatCondition,
  formatDate,
  formatMods,
  formatPercentage,
  formatScoreModel,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DanSystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemSlug: string }>;
  searchParams?: Promise<{ course?: string | string[] }>;
}) {
  const { systemSlug } = await params;
  const courses = await listDanCoursesBySystemSlug(systemSlug);

  if (courses.length === 0) {
    notFound();
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedCourseSlug = Array.isArray(resolvedSearchParams?.course)
    ? resolvedSearchParams?.course[0]
    : resolvedSearchParams?.course;
  const selectedCourse =
    courses.find((course) => course.courseSlug === requestedCourseSlug) ?? courses[0]!;
  const ranking = await getRankingForCourse(selectedCourse);
  const totalBeatmaps = courses.reduce((count, course) => count + course.beatmaps.length, 0);
  const system = courses[0]!;
  const command = `!dojo start ${selectedCourse.danSystemSlug} ${selectedCourse.courseSlug}`;
  const topResults = ranking.results.slice(0, 10);

  return (
    <main className="page-shell">
      <section className="detail-header dan-overview-header">
        <Link className="back-link" href="/dan">
          Back to systems
        </Link>
        <h1>{system.danSystemName}</h1>
        <p className="detail-copy">
          Pick a course tab, inspect the map sequence, and keep the strongest
          recent runs visible without turning the page into one long archive.
        </p>

        <div className="detail-stats">
          <div>
            <span>Courses</span>
            <strong>{courses.length}</strong>
          </div>
          <div>
            <span>Total maps</span>
            <strong>{totalBeatmaps}</strong>
          </div>
          <div>
            <span>Command</span>
            <strong>
              <code>{command}</code>
            </strong>
          </div>
        </div>

        <div className="stage-summary-list" role="tablist" aria-label="Course selector">
          {courses.map((course) => (
            <Link
              className={`stage-summary-row${
                course.id === selectedCourse.id ? " is-active" : ""
              }`}
              href={`/dan/${systemSlug}?course=${course.courseSlug}`}
              key={course.id}
              role="tab"
              aria-selected={course.id === selectedCourse.id}
            >
              <div>
                <p className="stage-label">{course.courseSlug}</p>
                <strong>{course.name}</strong>
              </div>
              <div className="stage-summary-meta">
                <span>{formatScoreModel(course.scoreModel)}</span>
                <span>{course.beatmaps.length} maps</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="sequence-card detail-sequence-card">
        <div className="section-heading course-section-heading">
          <div>
            <p className="eyebrow">{selectedCourse.courseSlug}</p>
            <h2>{selectedCourse.name}</h2>
            <p className="detail-copy">{selectedCourse.description}</p>
          </div>
          <div className="course-heading-meta">
            <span>{formatScoreModel(selectedCourse.scoreModel)}</span>
            <span>
              {selectedCourse.overallPassType && selectedCourse.overallPassThreshold !== null
                ? formatCondition(
                    selectedCourse.overallPassType,
                    selectedCourse.overallPassThreshold,
                  )
                : "Per-map only"}
            </span>
          </div>
        </div>

        <div className="stats-grid">
          <div>
            <span>Maps</span>
            <strong>{selectedCourse.beatmaps.length}</strong>
          </div>
          <div>
            <span>Overall</span>
            <strong>
              {selectedCourse.overallPassType && selectedCourse.overallPassThreshold !== null
                ? formatCondition(
                    selectedCourse.overallPassType,
                    selectedCourse.overallPassThreshold,
                  )
                : "Per-map only"}
            </strong>
          </div>
          <div>
            <span>Start</span>
            <strong>
              <code>{command}</code>
            </strong>
          </div>
        </div>

        <div className="results-layout">
          <section className="dan-stage-section">
            <div className="section-heading">
              <h2>Course sequence</h2>
            </div>

            <div className="dan-stage-stack">
              {selectedCourse.beatmaps.map((beatmap) => {
                const beatmapUrl = `https://osu.ppy.sh/b/${beatmap.beatmapId}`;

                return (
                  <article className="dan-stage-card" key={beatmap.id}>
                    <a
                      className="dan-stage-cover-wrap"
                      href={beatmapUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {beatmap.coverUrl ? (
                        <img
                          alt={`${beatmap.title} cover`}
                          className="dan-stage-cover"
                          src={beatmap.coverUrl}
                        />
                      ) : (
                        <div className="dan-stage-cover dan-stage-cover-placeholder" />
                      )}
                      <span className="beatmap-order">
                        {String(beatmap.ordinal).padStart(2, "0")}
                      </span>
                    </a>

                    <div className="dan-stage-body">
                      <div className="dan-stage-heading">
                        <div className="dan-stage-title-wrap">
                          <div className="dan-stage-kicker-row">
                            <span className="difficulty-chip">{beatmap.difficultyName}</span>
                            <span className="mod-chip">{formatMods(beatmap.mods)}</span>
                          </div>
                          <a href={beatmapUrl} rel="noreferrer" target="_blank">
                            <h3>{beatmap.title}</h3>
                          </a>
                          <p className="dan-stage-subline">
                            {beatmap.artist} • mapped by {beatmap.mapper}
                          </p>
                        </div>
                      </div>

                      <div className="dan-stage-footer">
                        <p className="dan-stage-condition">
                          Pass condition:{" "}
                          {formatCondition(
                            beatmap.passConditionType,
                            beatmap.passConditionThreshold,
                          )}
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
                      <th>Status</th>
                      <th>
                        {selectedCourse.scoreModel === "scorev1"
                          ? "Course Acc"
                          : "Score Total"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topResults.map((result) => {
                      const metricValue =
                        selectedCourse.scoreModel === "scorev1"
                          ? formatPercentage(result.summedAccuracy)
                          : new Intl.NumberFormat("en-US").format(
                              Math.round(result.totalScore),
                            );
                      const matchUrl = result.matchId
                        ? `https://osu.ppy.sh/mp/${result.matchId}`
                        : null;

                      return (
                        <tr key={result.id}>
                          <td className="ranking-rank-cell">{result.rank}</td>
                          <td>
                            <div className="ranking-player-cell">
                              <strong className="ranking-player-name">
                                {result.username}
                              </strong>
                              <span className="ranking-player-date">
                                {formatDate(result.completedAt)}
                              </span>
                            </div>
                          </td>
                          <td>
                            <strong className={getRunStatusClassName(result.status)}>
                              {result.status.toUpperCase()}
                            </strong>
                          </td>
                          <td className="numeric-cell">
                            <div className="ranking-metric-cell">
                              {matchUrl ? (
                                <a
                                  className="ranking-metric-link"
                                  href={matchUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {metricValue}
                                </a>
                              ) : (
                                <span>{metricValue}</span>
                              )}
                              <span className="ranking-metric-subline">
                                {matchUrl ? "match" : "-"}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <article className="empty-card compact-empty-card">
                <h2>No runs saved yet</h2>
                <p>
                  Start the bot with <code>{command}</code> and the next completed
                  course will appear here.
                </p>
              </article>
            )}
          </section>
        </div>
      </section>
    </main>
  );
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
