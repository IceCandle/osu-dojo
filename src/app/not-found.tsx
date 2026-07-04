import React from "react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="empty-card">
        <p className="eyebrow">404</p>
        <h1>That page does not exist.</h1>
        <p>Check the address or return to the home page.</p>
        <Link className="results-link" href="/">
          Back home
        </Link>
      </section>
    </main>
  );
}
