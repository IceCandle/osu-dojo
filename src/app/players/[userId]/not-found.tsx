import Link from "next/link";

export default function PlayerNotFound() {
  return (
    <main className="page-shell">
      <section className="empty-card player-empty-card">
        <p className="eyebrow">404</p>
        <h1>No local osu!dojo record</h1>
        <p>We couldn't find any locally saved login or run history for this user.</p>
        <Link className="results-link" href="/">
          Back home
        </Link>
      </section>
    </main>
  );
}
