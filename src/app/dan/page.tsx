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
              Each system groups related dan courses under one scoring model.
            </p>
          </div>
          <div className="scope-panel">
            <span className="scope-badge">How it works</span>
            <p>Open a system to compare its courses without losing the full set.</p>
            <p>Each course keeps its map order, pass rules, and top clears close together.</p>
          </div>
        </div>
      </section>

      <section className="systems-grid systems-grid-index">
        {systems.map((system) => (
          <Link className="system-link-card" href={`/dan/${system.slug}`} key={system.id}>
            <article className="system-card system-card-index">
              <div className="system-heading">
                <h2>{system.name}</h2>
                <p className="system-card-description">{system.description}</p>
              </div>

              <div className="system-card-meta">
                <div>
                  <span>Courses</span>
                  <strong>{system.dans.length}</strong>
                </div>
              </div>
            </article>
          </Link>
        ))}
      </section>
    </main>
  );
}
