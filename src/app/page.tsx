import React from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <main className="page-shell">
      <section className="masthead">
        <p className="masthead-kicker">osu!dojo / multiplayer discipline</p>
        <div className="masthead-grid">
          <div>
            <h1>Stable-hosted dan runs, judged automatically.</h1>
            <p className="masthead-copy">
              DM the bot with{" "}
              <code>!dojo start &lt;systemSlug&gt; &lt;courseSlug&gt;</code>, get
              invited into an automated multiplayer room, and let the course
              sequence, scoring, and leaderboard archive run themselves.
            </p>
            <div className="masthead-actions">
              <Link className="cta-link" href="/dan">
                Browse dan systems
              </Link>
            </div>
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
    </main>
  );
}
