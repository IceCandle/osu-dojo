import React from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <main className="page-shell">
      <section className="masthead">
        <p className="masthead-kicker">osu!dojo</p>
        <div className="masthead-grid">
          <div>
            <h1>Stable-hosted dan runs, judged automatically.</h1>
            <p className="masthead-copy">
              DM the bot with <code>!dojo start &lt;system&gt; &lt;course&gt;</code>,
              get invited into an automated multiplayer room, and let the course
              sequence, scoring, and leaderboard archive run themselves.
            </p>
            <div className="masthead-actions">
              <Link className="cta-link" href="/dan">
                Browse dan systems
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
    </main>
  );
}
