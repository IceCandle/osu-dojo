import React from "react";
import Link from "next/link";
import { listDanSystemsWithDans } from "@/db/queries";

export const dynamic = "force-dynamic";

export default async function DanSystemsPage() {
  const systems = await listDanSystemsWithDans();

  return (
    <main className="page-shell">
      <section className="detail-header dan-directory-header">
        <p className="masthead-kicker">dans</p>
        <div className="directory-heading">
          <div>
            <h1>Dan systems, archived cleanly.</h1>
            <p className="detail-copy">
              Browse each system, pick a course, and inspect the compact run
              snapshots without leaving the page.
            </p>
          </div>
          <div className="scope-panel">
            <span className="scope-badge">Current surface</span>
            <p>System pages focus on a single selected course at a time.</p>
            <p>The leaderboard rail is intentionally compact and capped.</p>
          </div>
        </div>
      </section>

      <section className="systems-grid systems-grid-index">
        {systems.map((system) => (
          <Link className="system-link-card" href={`/dan/${system.slug}`} key={system.id}>
            <article className="system-card system-card-index">
              <div className="system-heading">
                <p className="eyebrow">{system.slug}</p>
                <h2>{system.name}</h2>
                <p>{system.description}</p>
              </div>

              <div className="system-card-meta">
                <div>
                  <span>Courses</span>
                  <strong>{system.dans.length}</strong>
                </div>
                <span className="system-card-link">Open system</span>
              </div>
            </article>
          </Link>
        ))}
      </section>
    </main>
  );
}
