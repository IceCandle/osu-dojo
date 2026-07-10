import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import SearchOverlay from "@/app/SearchOverlay";
import { LoginControl } from "@/app/LoginControl";
import { AccountDisclosure } from "@/app/AccountDisclosure";
import { getSessionUser } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "osu!dojo",
  description: "Automated osu! dan courses with multiplayer judging and result tracking.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sessionUser = await getSessionUser();

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
              {sessionUser ? (
                <AccountDisclosure
                  userId={sessionUser.userId}
                  username={sessionUser.username}
                />
              ) : (
                <LoginControl />
              )}
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
