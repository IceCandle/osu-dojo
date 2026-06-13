"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useRef, useState } from "react";
import {
  emptySearchResults,
  isValidQuery,
  MAX_QUERY_LENGTH,
  type SearchResults,
} from "@/lib/search";

type SearchStatus = "idle" | "loading" | "success" | "error";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(emptySearchResults);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  function closeOverlay() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmedQuery = query.trim();
    if (!isValidQuery(trimmedQuery)) {
      requestIdRef.current += 1;
      setResults(emptySearchResults());
      setStatus("idle");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus("loading");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`);
        if (!response.ok) {
          throw new Error("Search request failed.");
        }

        const nextResults = (await response.json()) as SearchResults;
        if (requestIdRef.current === requestId) {
          setResults(nextResults);
          setStatus("success");
        }
      } catch {
        if (requestIdRef.current === requestId) {
          setResults(emptySearchResults());
          setStatus("error");
        }
      }
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, query]);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.offsetParent !== null || element === inputRef.current);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const hasQuery = isValidQuery(query);
  const hasResults =
    results.systems.length > 0 ||
    results.courses.length > 0 ||
    results.players.length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        aria-label="Search"
        className="site-search"
        type="button"
        onClick={() => setOpen(true)}
      >
        Search
      </button>

      {open ? (
        <div
          className="search-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeOverlay();
            }
          }}
        >
          <div
            ref={dialogRef}
            aria-labelledby="search-dialog-title"
            aria-modal="true"
            className="search-dialog"
            role="dialog"
            onKeyDown={handleDialogKeyDown}
          >
            <div className="search-dialog-header">
              <h2 id="search-dialog-title">Search</h2>
              <button
                aria-label="Close search"
                className="search-dialog-close"
                type="button"
                onClick={closeOverlay}
              >
                Close
              </button>
            </div>

            <input
              ref={inputRef}
              aria-label="Search dan systems and courses"
              className="search-dialog-input"
              maxLength={MAX_QUERY_LENGTH}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            <div className="search-dialog-results" aria-live="polite">
              {status === "loading" ? <p className="search-state">Searching...</p> : null}
              {status === "error" ? (
                <p className="search-state">Search failed. Try again.</p>
              ) : null}
              {status === "success" && !hasResults ? (
                <p className="search-state">No results.</p>
              ) : null}
              {!hasQuery && status === "idle" ? (
                <p className="search-state">Type a system, course, or player name.</p>
              ) : null}

              {results.systems.length > 0 ? (
                <section className="search-result-group" aria-labelledby="search-systems">
                  <h3 id="search-systems">Systems</h3>
                  <div className="search-result-list">
                    {results.systems.map((system) => (
                      <Link
                        className="search-result-row"
                        href={`/dan/${system.nameKey}`}
                        key={`system-${system.nameKey}`}
                        onClick={closeOverlay}
                      >
                        <span>{system.name}</span>
                        <span>{system.status}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              {results.courses.length > 0 ? (
                <section className="search-result-group" aria-labelledby="search-courses">
                  <h3 id="search-courses">Courses</h3>
                  <div className="search-result-list">
                    {results.courses.map((course) => (
                      <Link
                        className="search-result-row"
                        href={`/dan/${course.systemNameKey}?course=${course.nameKey}`}
                        key={`course-${course.systemNameKey}-${course.nameKey}`}
                        onClick={closeOverlay}
                      >
                        <span>{course.name}</span>
                        <span>{course.systemName}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              {results.players.length > 0 ? (
                <section className="search-result-group" aria-labelledby="search-players">
                  <h3 id="search-players">Players</h3>
                  <div className="search-result-list">
                    {results.players.map((player) => (
                      <Link
                        className="search-result-row search-result-row-player"
                        href={`/players/${player.userId}`}
                        key={`player-${player.userId}`}
                        onClick={closeOverlay}
                      >
                        <span className="search-player-identity">
                          <img alt="" src={player.avatarUrl} />
                          <span>{player.username}</span>
                        </span>
                        <span>{player.gameMode}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
