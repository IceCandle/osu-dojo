import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDanCourseBySlug } from "@/db/queries";
import { formatCondition, formatMods } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DanDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await getDanCourseBySlug(slug);

  if (!course) {
    notFound();
  }

  return (
    <main className="page-shell">
      <section className="detail-header">
        <Link className="back-link" href="/">
          Back to systems
        </Link>
        <p className="eyebrow">{course.danSystemName}</p>
        <h1>{course.name}</h1>
        <p className="detail-copy">{course.description}</p>

        <div className="detail-stats">
          <div>
            <span>Slug</span>
            <strong>{course.slug}</strong>
          </div>
          <div>
            <span>Maps</span>
            <strong>{course.beatmaps.length}</strong>
          </div>
          <div>
            <span>Overall</span>
            <strong>
              {course.overallPassType && course.overallPassThreshold !== null
                ? formatCondition(
                    course.overallPassType,
                    course.overallPassThreshold,
                  )
                : "Per-map only"}
            </strong>
          </div>
        </div>
      </section>

      <section className="sequence-card">
        <div className="section-heading">
          <h2>Course sequence</h2>
          <Link className="results-link" href={`/dan/${course.slug}/results`}>
            Recent results
          </Link>
        </div>

        <div className="beatmap-sequence">
          {course.beatmaps.map((beatmap) => (
            <article className="beatmap-card" key={beatmap.id}>
              <span className="beatmap-order">
                {String(beatmap.ordinal).padStart(2, "0")}
              </span>
              <div className="beatmap-body">
                <h3>Beatmap {beatmap.beatmapId}</h3>
                <p>{formatCondition(beatmap.passConditionType, beatmap.passConditionThreshold)}</p>
              </div>
              <div className="beatmap-side">
                <span>{formatMods(beatmap.mods)}</span>
                <a
                  href={`https://osu.ppy.sh/b/${beatmap.beatmapId}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open map
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
