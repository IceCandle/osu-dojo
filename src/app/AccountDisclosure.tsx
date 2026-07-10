"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface AccountDisclosureProps {
  userId: number;
  username: string;
}

export function AccountDisclosure({ userId, username }: AccountDisclosureProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const held = rootRef.current?.contains(document.activeElement);
      setOpen(false);
      // The panel unmounts this commit, dropping focus to body; restore next frame.
      if (held) window.requestAnimationFrame(() => triggerRef.current?.focus());
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function logout() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed.");
      window.location.assign("/");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="account-disclosure"
      data-ready={ready ? "true" : undefined}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
      ref={rootRef}
    >
      <button
        aria-controls="account-disclosure"
        aria-expanded={open}
        className="site-action account-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        {username}
      </button>
      {open ? (
        <div className="account-disclosure-panel" id="account-disclosure">
          <Link href={`/players/${userId}`} onClick={() => setOpen(false)}>
            My profile
          </Link>
          <button disabled type="button">My uploads</button>
          <Link href="/settings" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <button disabled={pending} onClick={() => void logout()} type="button">
            {pending ? "Signing out" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
