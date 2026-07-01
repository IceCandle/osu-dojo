"use client";

import { useState } from "react";
import Link from "next/link";

export function LogoutControl({ username }: { username: string }) {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("Logout failed.");
      }
      window.location.assign("/");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-controls">
      <Link className="site-action auth-user-link" href="/settings">
        {username}
      </Link>
      <button
        className="site-action"
        disabled={pending}
        onClick={logout}
        type="button"
      >
        {pending ? "Signing out" : "Logout"}
      </button>
    </div>
  );
}
