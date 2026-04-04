import React from "react";
import Link from "next/link";
import { listDanSystemsWithDans } from "@/db/queries";
import { formatCondition } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const systems = await listDanSystemsWithDans();

  return (
    <main className="page-shell">
      <section className="masthead">
        <p className="masthead-kicker">osu!dojo / multiplayer discipline</p>
        <div className="masthead-grid">
          <div>
            <h1>Stable-hosted dan runs, judged automatically.</h1>
            <p className="masthead-copy">
              DM the bot with <code>!dojo start &lt;dan_slug&gt;</code>, get
              invited into an automated multiplayer room, and let the course
              sequence, scoring, and results archive run themselves.
            </p>
          </div>

          <div className="scope-panel">
            <span className="scope-badge">Implementation boundary</span>
            <p>
              Accuracy parsing is currently implemented for{" "}
              <strong>osu!standard stable multiplayer scores</strong>.
            </p>
            <p>
              The project model stays open for other rulesets and lazer-aware
              scoring later.
            </p>
          </div>
        </div>
      </section>

      <section className="systems-grid">
        {systems.map((system) => (
          <article className="system-card" key={system.id}>
            <div className="system-heading">
              <p className="eyebrow">{system.slug}</p>
              <h2>{system.name}</h2>
              <p>{system.description}</p>
            </div>

            <div className="dan-list">
              {system.dans.map((dan) => (
                <Link className="dan-link" href={`/dan/${dan.slug}`} key={dan.id}>
                  <div>
                    <strong>{dan.name}</strong>
                    <span>{dan.slug}</span>
                  </div>
                  <div className="dan-link-meta">
                    <span>
                      {dan.overallPassType && dan.overallPassThreshold !== null
                        ? formatCondition(
                            dan.overallPassType,
                            dan.overallPassThreshold,
                          )
                        : "Per-map only"}
                    </span>
                    <span>Open course</span>
                  </div>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
