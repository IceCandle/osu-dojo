import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRankingForCourse, listCoursesByDanSystemNameKey } from "@/db/queries";
import {
  formatConditionCompact,
  formatMods,
  formatPercentage,
  formatScoreModel,
  kebabizeName,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DanSystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemNameKey: string }>;
  searchParams?: Promise<{ course?: string | string[] }>;
}) {
  const { systemNameKey } = await params;
  const courses = await listCoursesByDanSystemNameKey(systemNameKey);

  if (courses.length === 0) {
    notFound();
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

  const ranking = await getRankingForCourse(selectedCourse);
  const system = courses[0]!;
  const systemNameKeyForLinks = kebabizeName(system.danSystemName);
  const command = `!dojo start ${systemNameKeyForLinks} ${kebabizeName(selectedCourse.name)}`;
  const topResults = ranking.results.slice(0, 10);
  const overallRequirement =
    selectedCourse.overallPassType && selectedCourse.overallPassThreshold !== null
      ? `${formatConditionCompact(
          selectedCourse.overallPassType,
          selectedCourse.overallPassThreshold,
        )}`
      : "Per-map pass only";

  return (
    <main className="page-shell">
      <section className="detail-header dan-overview-header">
        <div className="system-header-grid">
          <div>
            <h1>{system.danSystemName}</h1>
            <p className="detail-copy">{system.danSystemDescription}</p>
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
                        <p className="mod-label">{formatMods(beatmap.mods)}</p>
                      </div>

                      <div className="course-beatmap-footer">
                        <p className="course-beatmap-condition">
                          {formatConditionCompact(
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
                          <td
                            className={`ranking-rank-cell ${getRunStatusClassName(
                              result.status,
                            )}`}
                          >
                            {result.rank}
                          </td>
                          <td>
                            <strong className="ranking-player-name">{result.username}</strong>
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
