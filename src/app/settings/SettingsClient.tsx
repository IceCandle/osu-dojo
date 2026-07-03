"use client";

import { useState } from "react";
import type { PinnedClearView, RunPick } from "@/lib/domain";
import { formatPercentage } from "@/lib/format";

interface SettingsClientProps {
  initialProfileDetailsPublic: boolean;
  initialPinnedMode: "auto" | "manual";
  initialSelectedRuns: PinnedClearView[];
  initialRunPage: { runs: RunPick[]; nextCursor: string | null };
}

type SelectedRun = Pick<
  RunPick,
  "runId" | "courseId" | "courseName" | "courseLabel" | "systemName"
> & { ordinal: number };

export function SettingsClient({
  initialProfileDetailsPublic,
  initialPinnedMode,
  initialSelectedRuns,
  initialRunPage,
}: SettingsClientProps) {
  const [profileDetailsPublic, setProfileDetailsPublic] = useState(
    initialProfileDetailsPublic,
  );
  const [pinnedMode, setPinnedMode] = useState(initialPinnedMode);
  const [selectedRuns, setSelectedRuns] = useState<SelectedRun[]>(
    initialSelectedRuns,
  );
  const [availableRuns, setAvailableRuns] = useState(initialRunPage.runs);
  const [nextCursor, setNextCursor] = useState(initialRunPage.nextCursor);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function updateVisibility(nextValue: boolean) {
    const previous = profileDetailsPublic;
    setProfileDetailsPublic(nextValue);
    setPending("visibility");
    setNotice(null);
    try {
      const response = await fetch("/api/settings/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileDetailsPublic: nextValue }),
      });
      if (!response.ok) {
        throw new Error();
      }
      setNotice("공개 설정을 저장했습니다.");
    } catch {
      setProfileDetailsPublic(previous);
      setNotice("공개 설정을 저장하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function saveManualPins() {
    setPending("pins");
    setNotice(null);
    try {
      const response = await fetch("/api/settings/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          runIds: selectedRuns.map((run) => run.runId),
        }),
      });
      if (!response.ok) {
        throw new Error();
      }
      const body = (await response.json()) as {
        mode: "manual";
        pinned: PinnedClearView[];
      };
      setPinnedMode(body.mode);
      setSelectedRuns(body.pinned);
      setNotice("대표 클리어를 저장했습니다.");
    } catch {
      setNotice("대표 클리어를 저장하지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function useAutomaticPins() {
    setPending("pins");
    setNotice(null);
    try {
      const response = await fetch("/api/settings/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      });
      if (!response.ok) {
        throw new Error();
      }
      setPinnedMode("auto");
      setSelectedRuns([]);
      setNotice("자동 선택으로 돌아갔습니다.");
    } catch {
      setNotice("자동 선택으로 바꾸지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function loadMoreRuns() {
    if (!nextCursor) {
      return;
    }
    setPending("runs");
    try {
      const response = await fetch(
        `/api/settings/runs?cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!response.ok) {
        throw new Error();
      }
      const body = (await response.json()) as {
        runs: RunPick[];
        nextCursor: string | null;
      };
      setAvailableRuns((current) => [...current, ...body.runs]);
      setNextCursor(body.nextCursor);
    } catch {
      setNotice("run 목록을 더 불러오지 못했습니다.");
    } finally {
      setPending(null);
    }
  }

  function addRun(run: RunPick) {
    if (
      selectedRuns.length >= 5 ||
      selectedRuns.some((selected) => selected.runId === run.runId)
    ) {
      return;
    }
    setPinnedMode("manual");
    setSelectedRuns((current) => [
      ...current,
      {
        runId: run.runId,
        courseId: run.courseId,
        courseName: run.courseName,
        courseLabel: run.courseLabel,
        systemName: run.systemName,
        ordinal: current.length,
      },
    ]);
  }

  function removeRun(runId: string) {
    setPinnedMode("manual");
    setSelectedRuns((current) =>
      current
        .filter((run) => run.runId !== runId)
        .map((run, ordinal) => ({ ...run, ordinal })),
    );
  }

  function moveRun(index: number, direction: -1 | 1) {
    setPinnedMode("manual");
    setSelectedRuns((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next.map((run, ordinal) => ({ ...run, ordinal }));
    });
  }

  const selectedIds = new Set(selectedRuns.map((run) => run.runId));

  return (
    <div className="settings-grid">
      <section className="sequence-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Visibility</p>
            <h2>프로필 상세 기록</h2>
          </div>
        </div>
        <label className="settings-toggle">
          <input
            checked={profileDetailsPublic}
            disabled={pending === "visibility"}
            onChange={(event) => void updateVisibility(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>프로필 상세 기록 공개</strong>
            <small>
              끄면 다른 사용자에게 최근 run, 점수, 대표 클리어를 숨깁니다.
            </small>
          </span>
        </label>
      </section>

      <section className="sequence-card settings-card settings-pins-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Pinned clears</p>
            <h2>대표 클리어</h2>
          </div>
          <span className="settings-mode">{pinnedMode}</span>
        </div>

        <div className="settings-selected-runs">
          {selectedRuns.length === 0 ? (
            <p className="settings-empty">
              {pinnedMode === "auto"
                ? "현재 자동으로 대표 클리어를 고릅니다."
                : "수동 대표 클리어가 없습니다."}
            </p>
          ) : (
            selectedRuns.map((run, index) => (
              <article className="settings-run-card" key={run.runId}>
                <div>
                  <strong>{run.courseLabel ?? run.courseName}</strong>
                  <span>{run.systemName}</span>
                </div>
                <div className="settings-run-actions">
                  <button
                    aria-label={`${run.courseName} 위로 이동`}
                    disabled={index === 0}
                    onClick={() => moveRun(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`${run.courseName} 아래로 이동`}
                    disabled={index === selectedRuns.length - 1}
                    onClick={() => moveRun(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`${run.courseName} 대표 클리어에서 제거`}
                    onClick={() => removeRun(run.runId)}
                    type="button"
                  >
                    제거
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="settings-run-picker">
          <h3>통과한 run에서 선택</h3>
          {availableRuns.length === 0 ? (
            <p className="settings-empty">저장된 pass run이 없습니다.</p>
          ) : (
            availableRuns.map((run) => (
              <article className="settings-run-option" key={run.runId}>
                <div>
                  <strong>{run.courseLabel ?? run.courseName}</strong>
                  <span>
                    {run.systemName} · {formatRunMetric(run)}
                  </span>
                </div>
                <button
                  disabled={selectedIds.has(run.runId) || selectedRuns.length >= 5}
                  onClick={() => addRun(run)}
                  type="button"
                >
                  {selectedIds.has(run.runId) ? "선택됨" : "추가"}
                </button>
              </article>
            ))
          )}
          {nextCursor ? (
            <button
              className="settings-secondary-button"
              disabled={pending === "runs"}
              onClick={() => void loadMoreRuns()}
              type="button"
            >
              더 보기
            </button>
          ) : null}
        </div>

        <div className="settings-actions">
          <button
            className="cta-link"
            disabled={pending === "pins"}
            onClick={() => void saveManualPins()}
            type="button"
          >
            수동 선택 저장
          </button>
          <button
            className="settings-secondary-button"
            disabled={pending === "pins"}
            onClick={() => void useAutomaticPins()}
            type="button"
          >
            자동 선택 사용
          </button>
        </div>
      </section>

      {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
    </div>
  );
}

function formatRunMetric(run: RunPick) {
  if (run.totalScore > 0) {
    return new Intl.NumberFormat("en-US").format(Math.round(run.totalScore));
  }
  return formatPercentage(run.summedAccuracy);
}
