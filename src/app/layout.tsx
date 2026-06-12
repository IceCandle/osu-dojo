import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import SearchOverlay from "@/app/SearchOverlay";
import "./globals.css";

export const metadata: Metadata = {
  title: "osu!dojo",
  description: "Automated osu! dan courses with multiplayer judging and result tracking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-shell">
            <Link className="site-brand" href="/">
              <span className="site-brand-mark">osu!dojo</span>
              <span className="site-brand-copy">automated dan archive</span>
            </Link>

            <nav className="site-nav" aria-label="Primary">
              <Link className="site-nav-link" href="/dan">
                dans
              </Link>
            </nav>

            <div className="site-header-tools">
              <SearchOverlay />
              <button className="site-action" disabled type="button">
                Upload
              </button>
              <button className="site-action site-action-primary" disabled type="button">
                osu!auth Login
              </button>
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
