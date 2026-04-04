import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listDanResultsBySlug } from "@/db/queries";
import {
  formatConditionValue,
  formatInteger,
  formatMods,
  formatTimestamp,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DanResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const payload = await listDanResultsBySlug(slug);

  if (!payload) {
    notFound();
  }

  return (
    <main className="page-shell">
      <section className="detail-header">
        <Link className="back-link" href={`/dan/${payload.course.slug}`}>
          Back to course
        </Link>
        <p className="eyebrow">recent archive</p>
        <h1>{payload.course.name} results</h1>
        <p className="detail-copy">
          Latest stored multiplayer runs for this course.
        </p>
      </section>

      <section className="results-stack">
        {payload.results.length === 0 ? (
          <article className="empty-card">
            <h2>No runs saved yet</h2>
            <p>
              Start the bot, run <code>!dojo start {payload.course.slug}</code>,
              and the next completed course will appear here.
            </p>
          </article>
        ) : (
          payload.results.map((result) => (
            <article className="result-card" key={result.id}>
              <div className="result-header">
                <div>
                  <p className="result-user">{result.username}</p>
                  <span>{formatTimestamp(result.completedAt)}</span>
                </div>
                <strong className={getRunStatusClassName(result.status)}>
                  {result.status.toUpperCase()}
                </strong>
              </div>

              <div className="result-maps">
                {result.maps.map((map) => (
                  <div className="result-map-row" key={map.id}>
                    <span>Map {map.ordinal}</span>
                    <span>{formatMods(map.mods)}</span>
                    <span>{formatConditionValue(map.passConditionType, map.accuracy)}</span>
                    <span>{formatInteger(map.score)}</span>
                    <strong className={map.passed ? "status-pass" : "status-fail"}>
                      {map.passed ? "PASS" : "FAIL"}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
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
