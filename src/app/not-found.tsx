import React from "react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="empty-card">
        <p className="eyebrow">404</p>
        <h1>That dan system does not exist.</h1>
        <p>Check the route or return to the home page to pick a seeded system.</p>
        <Link className="results-link" href="/">
          Back home
        </Link>
      </section>
    </main>
  );
}
