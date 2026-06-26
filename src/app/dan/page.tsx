import React from "react";
import Link from "next/link";
import { listDanSystemsWithCourses } from "@/db/queries";
import { kebabizeName } from "@/lib/format";
import { systemCapabilities } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function DanSystemsPage() {
  const systems = await listDanSystemsWithCourses();

  return (
    <main className="page-shell">
      <section className="detail-header dan-index-header">
        <p className="masthead-kicker">dans</p>
        <div className="directory-heading">
          <div>
            <h1>Dan systems</h1>
            <p className="detail-copy">
              Choose a system to view its courses, pass rules, and saved top runs.
            </p>
          </div>
        </div>
      </section>

      <section className="systems-grid systems-grid-index">
        {systems.map((system) => (
          <Link
            className="system-link-card"
            href={`/dan/${kebabizeName(system.name)}`}
            key={system.id}
          >
            <article className="system-card system-card-index">
              <div className="system-heading">
                <div className="system-title-row">
                  <h2>{system.name}</h2>
                  {systemCapabilities(system.status).badge ? (
                    <span className="system-status-pill">
                      {systemCapabilities(system.status).badge}
                    </span>
                  ) : null}
                </div>
                <p className="system-card-description">{system.description}</p>
              </div>

              <p className="system-card-metaline">{system.courses.length} courses</p>
            </article>
          </Link>
        ))}
      </section>
    </main>
  );
}
