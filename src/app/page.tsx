import React from "react";
import Link from "next/link";
import { LocalTime } from "@/app/LocalTime";
import { listNotablePasses } from "@/db/queries";
import { formatUtcDateTime } from "@/lib/format";
import { SUPPORTED_MODE_LABEL } from "@/lib/notablePasses";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const notablePasses = await listNotablePasses();

  return (
    <main className="page-shell">
      <section className="masthead">
        <p className="masthead-kicker">osu!dojo</p>
        <div className="masthead-grid">
          <div>
            <h1>Stable-hosted course runs, judged automatically.</h1>
            <p className="masthead-copy">
              DM the bot with <code>!dojo start &lt;system&gt; &lt;course&gt;</code>,
              get invited into an automated multiplayer room, and let the course
              sequence, scoring, and leaderboard archive run themselves.
            </p>
            <div className="masthead-actions">
              <Link className="cta-link cta-link-compact" href="/dan">
                View dan systems
              </Link>
            </div>
          </div>

          <div className="scope-panel">
            <span className="scope-badge">Right now</span>
            <p>
              Built for <strong>osu!standard stable multiplayer scores</strong>.
            </p>
            <p>
              Course commands, pass rules, and recent clears stay easy to inspect
              from one place.
            </p>
          </div>
        </div>
      </section>

      <section className="sequence-card notable-pass-section">
        <div className="notable-pass-heading">
          <div>
            <p className="eyebrow">Live archive</p>
            <h2>Recent notable passes</h2>
          </div>
          <span className="notable-pass-mode">{SUPPORTED_MODE_LABEL}</span>
        </div>

        {notablePasses.length > 0 ? (
          <div className="notable-pass-list">
            {notablePasses.map((pass) => (
              <article className="notable-pass-card" key={pass.runId}>
                <div className="notable-pass-player">
                  <Link href={`/players/${pass.userId}`}>{pass.username}</Link>
                  <p>
                    <strong>{pass.courseLabel ?? pass.courseName}</strong>
                    <span aria-hidden="true"> / </span>
                    {pass.systemName}
                  </p>
                </div>
                <div className="notable-pass-meta">
                  <span>Passed</span>
                  <LocalTime
                    value={pass.completedAt}
                    ssrFallback={formatUtcDateTime(pass.completedAt)}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="notable-pass-empty">No recent passes yet.</p>
        )}
      </section>
    </main>
  );
}
