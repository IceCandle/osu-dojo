"use client";

import { useEffect, useState } from "react";

interface PinnedClearControlProps {
  courseName: string;
  bestRun: {
    id: string;
    status: "pass" | "fail" | "dnf";
    metric: string;
  } | null;
  initialPinnedRunId: string | null;
}

export function PinnedClearControl({
  courseName,
  bestRun,
  initialPinnedRunId,
}: PinnedClearControlProps) {
  const [pinnedRunId, setPinnedRunId] = useState(initialPinnedRunId);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  if (!bestRun) {
    return (
      <p className="course-pin-empty" data-ready={ready ? "true" : undefined}>
        Complete this course to choose a pinned clear.
      </p>
    );
  }

  const canPin = bestRun.status === "pass";
  const isCurrentBestPinned = pinnedRunId === bestRun.id;
  const action = isCurrentBestPinned
    ? "Unpin"
    : pinnedRunId
      ? "Replace"
      : "Pin";

  async function updatePin() {
    if (!bestRun || !canPin || pending) {
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const pinned = !isCurrentBestPinned;
      const response = await fetch("/api/settings/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: bestRun.id, pinned }),
      });
      const body = (await response.json()) as { error?: string };
      if (response.status === 409 && body.error === "pin_limit") {
        setNotice("You can pin up to five courses.");
        return;
      }
      if (!response.ok) {
        throw new Error();
      }
      setPinnedRunId(pinned ? bestRun.id : null);
      setNotice(
        pinned
          ? action === "Replace"
            ? "Pinned clear replaced."
            : "Clear pinned."
          : "Pinned clear removed.",
      );
    } catch {
      setNotice("Could not update the pinned clear.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="course-pin-control" data-ready={ready ? "true" : undefined}>
      <div>
        <span className={`course-pin-status status-${bestRun.status}`}>
          {bestRun.status}
        </span>
        <strong>{bestRun.metric}</strong>
      </div>
      <button
        aria-label={`${action} pinned clear for ${courseName}`}
        className="course-pin-button"
        disabled={!canPin || pending}
        onClick={() => void updatePin()}
        type="button"
      >
        {pending ? "Saving…" : canPin ? action : "Pass required"}
      </button>
      {notice ? (
        <p className="course-pin-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
