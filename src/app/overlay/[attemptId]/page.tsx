'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getScoreAtTime, type ScoreTimestamp } from '@/lib/time-series';
import { F2Notification, useF2Notification } from '@/components/F2Notification';

/**
 * Time-Series Data (from API)
 */
interface TimeSeriesData {
  beatmapId: number;
  duration: number;
  finalScore: number;
  timeSeries: ScoreTimestamp[];
  rivalName?: string;
  isThresholdOnly?: boolean; // For clear mode (no time-series)
}

/**
 * Live Score from tosu
 */
interface LiveScore {
  score: number;
  accuracy: number;
  combo: number;
  maxCombo: number;
  time: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  sliderbreaks: number;
  hp: number;
}

/**
 * tosu WebSocket Data Structure
 */
interface TosuData {
  menu: {
    bm: {
      id: number;
      md5: string;
      time: {
        full: number;
        current: number;
      };
    };
  };
  gameplay: {
    state: number; // 0=Menu, 1=Edit, 2=Play, 7=Results
    score: number;
    accuracy: number;
    combo: {
      current: number;
      max: number;
    };
    hp: {
      normal: number;
      smooth: number;
    };
    time: {
      current: number;
      full: number;
    };
    hits: {
      300: number;
      100: number;
      50: number;
      0: number;
      sliderBreaks: number;
    };
  };
}

type RivalMode = 'clear' | 'gold-clear' | 'national' | 'friends' | 'same-rank' | 'rotate';

type OverlayView = 'full' | 'bars' | 'delta';

const RIVAL_MODE_OPTIONS = [
  { value: 'clear', label: 'Clear' },
  { value: 'gold-clear', label: 'Gold' },
  { value: 'national', label: 'National' },
] as const;

const CYCLEABLE_RIVAL_MODES = RIVAL_MODE_OPTIONS.map((o) => o.value);

function getNextRivalMode(current: RivalMode): RivalMode {
  const index = CYCLEABLE_RIVAL_MODES.indexOf(current as (typeof CYCLEABLE_RIVAL_MODES)[number]);
  if (index === -1) return CYCLEABLE_RIVAL_MODES[0] as RivalMode;
  return CYCLEABLE_RIVAL_MODES[(index + 1) % CYCLEABLE_RIVAL_MODES.length] as RivalMode;
}

/**
 * 3-Bar Pacemaker Overlay
 * YOU (blue) | MY-BEST (green) | RIVAL (red)
 */
export default function OverlayPage() {
  const { attemptId } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const viewParam = searchParams.get('view');
  const view: OverlayView = viewParam === 'bars' || viewParam === 'delta' ? viewParam : 'full';

  // State
  const [myBest, setMyBest] = useState<TimeSeriesData | null>(null);
  const [rival, setRival] = useState<TimeSeriesData | null>(null);
  const [liveScore, setLiveScore] = useState<LiveScore | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mapValidationError, setMapValidationError] = useState<string | null>(null);
  const [clearThreshold, setClearThreshold] = useState<number>(0);
  const [goldThreshold, setGoldThreshold] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const lastStateRef = useRef<number>(0);
  const liveScoreRef = useRef<LiveScore | null>(null);
  const rivalRef = useRef<TimeSeriesData | null>(null);
  const mapValidationErrorRef = useRef<string | null>(null);
  const clearThresholdRef = useRef<number>(0);

  // F2 Notification (for replay saving)
  const { showNotification, countdown, triggerF2Notification } = useF2Notification();

  // Config
  const ipParam = searchParams.get('ip');
  const modeParam = searchParams.get('mode');

  const [tosuHost, setTosuHost] = useState<string>(ipParam || 'localhost');
  const initialRivalMode = (modeParam || 'clear') as RivalMode;
  const [rivalMode, setRivalMode] = useState<RivalMode>(initialRivalMode);
  const [modeChangeNotification, setModeChangeNotification] = useState<string | null>(null);
  const f2CountdownDuration = parseInt(searchParams.get('f2Countdown') || '5', 10); // Adjustable countdown (default: 5s)

  const rivalModeRef = useRef<RivalMode>(initialRivalMode);

  const setRivalModeWithNotice = (nextMode: RivalMode) => {
    setRivalMode(nextMode);
    setModeChangeNotification(`Rival: ${nextMode}`);
    window.setTimeout(() => setModeChangeNotification(null), 2000);
  };

  const [tosuHostInput, setTosuHostInput] = useState<string>(tosuHost);

  useEffect(() => {
    // Keep local state aligned with URL changes (e.g., Connect button)
    setTosuHost(ipParam || 'localhost');
    setTosuHostInput(ipParam || 'localhost');
  }, [ipParam]);

  useEffect(() => {
    // Apply persisted settings only when URL params don't explicitly override.
    try {
      if (!modeParam) {
        const storedMode = window.localStorage.getItem('osu-dojo:overlay:mode') as RivalMode | null;
        if (storedMode && (CYCLEABLE_RIVAL_MODES as readonly string[]).includes(storedMode)) {
          setRivalMode(storedMode);
        }
      }

      if (!ipParam) {
        const storedIp = window.localStorage.getItem('osu-dojo:overlay:ip');
        if (storedIp && storedIp.trim()) {
          setTosuHost(storedIp.trim());
          setTosuHostInput(storedIp.trim());
        }
      }
    } catch {
      // localStorage may be unavailable in some embedded contexts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('osu-dojo:overlay:mode', rivalMode);
    } catch {
      // ignore
    }
  }, [rivalMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem('osu-dojo:overlay:ip', tosuHost);
    } catch {
      // ignore
    }
  }, [tosuHost]);

  useEffect(() => {
    rivalRef.current = rival;
  }, [rival]);

  useEffect(() => {
    mapValidationErrorRef.current = mapValidationError;
  }, [mapValidationError]);

  useEffect(() => {
    clearThresholdRef.current = clearThreshold;
  }, [clearThreshold]);

  useEffect(() => {
    rivalModeRef.current = rivalMode;
  }, [rivalMode]);

  // Hotkey: press R to cycle rival mode (kept as a shortcut; select remains visible)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setRivalModeWithNotice(getNextRivalMode(rivalModeRef.current));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * 1. Fetch My-Best Data
   */
  useEffect(() => {
    async function fetchMyBest() {
      try {
        const response = await fetch(`/api/attempts/${attemptId}/my-best`);
        if (!response.ok) {
          console.warn('My-best data not found (first attempt?)');
          return;
        }
        const data = await response.json();
        setMyBest(data);
      } catch (error) {
        console.error('Failed to load my-best:', error);
      }
    }

    fetchMyBest();
  }, [attemptId]);

  /**
   * 2. Fetch Rival Data (refetches when rivalMode changes)
   */
  useEffect(() => {
    async function fetchRival() {
      try {
        const response = await fetch(`/api/attempts/${attemptId}/rival?mode=${rivalMode}`);
        if (!response.ok) {
          console.warn(`Rival data not found for mode: ${rivalMode}`);
          setRival(null);
          return;
        }
        const data = await response.json();
        setRival(data);

        // If clear mode, extract thresholds
        if (data.isThresholdOnly) {
          if (rivalMode === 'gold-clear') {
            setGoldThreshold(data.finalScore);
            setClearThreshold(0);
          } else {
            setClearThreshold(data.finalScore);
            setGoldThreshold(0);
          }
        }
      } catch (error) {
        console.error('Failed to load rival:', error);
        setRival(null);
      }
    }

    fetchRival();
  }, [attemptId, rivalMode]); // Dependency on rivalMode triggers refetch

  /**
   * 3. Connect to tosu WebSocket
   */
  useEffect(() => {
    const ws = new WebSocket(`ws://${tosuHost}:24050/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[tosu] Connected');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: TosuData = JSON.parse(event.data);

        // Detect map completion
        if (lastStateRef.current === 2 && data.gameplay.state === 7) {
          console.log('[Overlay] Map completed, sending live stats');

          const latestLive = liveScoreRef.current;
          if (latestLive) {
            // Check if player passed (score >= clear threshold)
            const threshold = clearThresholdRef.current;
            const passed = threshold > 0 && latestLive.score >= threshold;

            if (passed) {
              console.log('[Overlay] PASS detected! Showing F2 notification');
              triggerF2Notification(f2CountdownDuration);
            }

            // Send live stats to API
            fetch(`/api/attempts/${attemptId}/live-stats`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                beatmapId: data.menu.bm.id,
                sliderbreaks: latestLive.sliderbreaks,
                maxCombo: latestLive.maxCombo,
                count300: latestLive.count300,
                count100: latestLive.count100,
                count50: latestLive.count50,
                countMiss: latestLive.countMiss,
              }),
            }).catch((err) => console.error('[Overlay] Error posting live stats:', err));
          }
        }

        lastStateRef.current = data.gameplay.state;

        // Only process when playing
        if (data.gameplay.state !== 2) {
          setIsPlaying(false);
          return;
        }

        setIsPlaying(true);

        // Beatmap ID validation
        const currentRival = rivalRef.current;
        if (currentRival && data.menu.bm.id !== currentRival.beatmapId) {
          setMapValidationError(
            `Wrong map! Expected: ${currentRival.beatmapId}, Got: ${data.menu.bm.id}`,
          );
          return;
        }

        if (mapValidationErrorRef.current) {
          setMapValidationError(null);
        }

        // Update live score
        const nextLive: LiveScore = {
          score: data.gameplay.score,
          accuracy: data.gameplay.accuracy,
          combo: data.gameplay.combo.current,
          maxCombo: data.gameplay.combo.max,
          time: data.gameplay.time.current,
          count300: data.gameplay.hits[300],
          count100: data.gameplay.hits[100],
          count50: data.gameplay.hits[50],
          countMiss: data.gameplay.hits[0],
          sliderbreaks: data.gameplay.hits.sliderBreaks || 0,
          hp: data.gameplay.hp.smooth,
        };
        liveScoreRef.current = nextLive;
        setLiveScore(nextLive);
      } catch (error) {
        console.error('[tosu] Parse error:', error);
      }
    };

    ws.onerror = () => setWsConnected(false);
    ws.onclose = () => setWsConnected(false);

    return () => ws.close();
  }, [tosuHost, attemptId, triggerF2Notification, f2CountdownDuration]);

  /**
   * 4. Calculate interpolated scores at current timestamp
   */
  const comparison = (() => {
    if (!liveScore || !isPlaying) return null;

    const currentTime = liveScore.time;

    // MY-BEST score at current time
    const myBestAtTime =
      myBest && !myBest.isThresholdOnly ? getScoreAtTime(myBest.timeSeries, currentTime) : null;

    // RIVAL score at current time
    const rivalAtTime =
      rival && !rival.isThresholdOnly ? getScoreAtTime(rival.timeSeries, currentTime) : null;

    // Score differences
    const myBestDiff = myBestAtTime ? liveScore.score - myBestAtTime.score : 0;
    const rivalDiff = rivalAtTime ? liveScore.score - rivalAtTime.score : 0;

    return {
      myBestAtTime,
      rivalAtTime,
      myBestDiff,
      rivalDiff,
    };
  })();

  /**
   * 5. Convert score to bar height (0-100% of screen)
   */
  const scoreToHeight = (score: number): number => {
    const maxScore = 1_000_000;
    return Math.min((score / maxScore) * 80, 80); // Cap at 80% of screen
  };

  /**
   * 6. Convert score to Y position for horizontal lines (from bottom)
   */
  const scoreToY = (score: number): string => {
    const percent = scoreToHeight(score);
    return `${100 - percent}%`; // Invert (0% = top, 100% = bottom)
  };

  /**
   * Render
   */
  if (view !== 'full' && !isPlaying) {
    // Multi-source OBS mode: render nothing while idle.
    return <div className="h-screen w-screen bg-transparent" />;
  }

  const showHud = view === 'full';
  const showBars = view === 'full' || view === 'bars';
  const showDelta = view === 'full' || view === 'delta';

  return (
    <div className="relative h-screen w-screen bg-transparent overflow-hidden">
      {/* Connection Status */}
      {showHud && (
        <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-white text-sm">{wsConnected ? 'tosu ✓' : 'tosu ✗'}</span>
          <a
            className="ml-3 rounded bg-black/40 px-2 py-1 text-xs text-white hover:bg-black/60"
            href={`/attempts/${String(attemptId)}/stats`}
            target="_blank"
            rel="noreferrer"
            title="Open public pass score statistics"
          >
            Stats
          </a>
          <div className="ml-4 flex items-center gap-2">
            <label className="text-white text-xs" htmlFor="rival-mode">
              Mode
            </label>
            <select
              id="rival-mode"
              className="px-2 py-1 text-xs rounded bg-black/40 text-white outline-none"
              value={rivalMode}
              onChange={(e) => setRivalModeWithNotice(e.target.value as RivalMode)}
            >
              {RIVAL_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-gray-400">(R)</span>
          </div>
        </div>
      )}

      {/* Top-Right Scores */}
      {isPlaying && liveScore && rival && (
        <div className="absolute top-4 right-4 z-50 text-right text-white text-2xl font-bold">
          <div>YOU: {liveScore.score.toLocaleString()}</div>
          <div className="text-red-400">
            {rival.rivalName || 'RIVAL'}: {rival.finalScore.toLocaleString()}
          </div>
        </div>
      )}

      {/* Map Validation Error */}
      {mapValidationError && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 px-6 py-3 rounded-lg">
          <p className="text-white font-bold">⚠️ {mapValidationError}</p>
        </div>
      )}

      {/* Mode Change Notification */}
      {modeChangeNotification && (
        <div className="absolute top-32 left-1/2 transform -translate-x-1/2 z-50 bg-blue-600 px-6 py-3 rounded-lg">
          <p className="text-white font-bold">{modeChangeNotification}</p>
        </div>
      )}

      {/* Not Playing State */}
      {!isPlaying && (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center text-white">
            <h1 className="text-4xl font-bold mb-4">osu!dojo Pacemaker</h1>
            <p className="text-xl text-gray-400">
              {wsConnected ? 'Start playing...' : 'Start tosu to begin'}
            </p>
            <p className="text-sm text-gray-500 mt-4">Mode: {rivalMode}</p>
            <p className="text-xs text-gray-600 mt-2">Press &apos;R&apos; to cycle mode</p>

            {!wsConnected && (
              <div className="mt-6 flex flex-col items-center gap-3">
                <div className="text-xs text-gray-500">Enter Tosu host/IP (default: localhost)</div>
                <div className="flex items-center gap-2">
                  <input
                    className="px-3 py-2 rounded bg-black/40 text-white text-sm w-56 outline-none"
                    value={tosuHostInput}
                    onChange={(e) => setTosuHostInput(e.target.value)}
                    placeholder="localhost"
                  />
                  <button
                    className="px-3 py-2 rounded bg-white text-black text-sm"
                    type="button"
                    onClick={() => {
                      const trimmed = tosuHostInput.trim() || 'localhost';
                      setTosuHost(trimmed);
                      const next = new URLSearchParams(searchParams.toString());
                      next.set('ip', trimmed);
                      router.replace(`/overlay/${String(attemptId)}?${next.toString()}`);
                    }}
                  >
                    Connect
                  </button>
                </div>
                <div className="text-[10px] text-gray-600">
                  WebSocket: ws://&lt;host&gt;:24050/ws
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Playing State - 3 Vertical Bars */}
      {isPlaying && liveScore && comparison && (
        <>
          {showBars && (
            <>
              {/* MAX SCORE Line (1M) */}
              <div
                className="absolute w-full border-t-2 border-white opacity-30 z-10"
                style={{ top: scoreToY(1_000_000) }}
              >
                <span className="absolute right-4 -top-3 text-white text-xs">1,000,000</span>
              </div>

              {/* GOLD Threshold Line */}
              {goldThreshold > 0 && (
                <div
                  className="absolute w-full border-t-2 border-yellow-500 opacity-50 z-10"
                  style={{ top: scoreToY(goldThreshold) }}
                >
                  <span className="absolute right-4 -top-3 text-yellow-500 text-xs">GOLD</span>
                </div>
              )}

              {/* CLEAR Threshold Line */}
              {clearThreshold > 0 && (
                <div
                  className="absolute w-full border-t-2 border-red-500 opacity-50 z-10"
                  style={{ top: scoreToY(clearThreshold) }}
                >
                  <span className="absolute right-4 -top-3 text-red-500 text-xs">CLEAR</span>
                </div>
              )}

              {/* 3 Vertical Bars Container */}
              <div className="absolute bottom-0 left-0 right-0 h-4/5 flex justify-center items-end gap-12 z-20">
                {/* Bar 1: YOU (Blue, filled only) */}
                <div className="relative w-32 h-full flex flex-col justify-end">
                  <div
                    className="w-full bg-blue-500 transition-all duration-100"
                    style={{ height: `${scoreToHeight(liveScore.score)}%` }}
                  />
                </div>

                {/* Bar 2: MY-BEST (Green, filled + hollow outline) */}
                {myBest && !myBest.isThresholdOnly && comparison.myBestAtTime && (
                  <div className="relative w-32 h-full flex flex-col justify-end">
                    {/* Hollow outline (static at final score) */}
                    <div
                      className="absolute bottom-0 w-full border-4 border-green-500 bg-transparent pointer-events-none"
                      style={{ height: `${scoreToHeight(myBest.finalScore)}%` }}
                    />
                    {/* Filled bar (grows with current timestamp) */}
                    <div
                      className="w-full bg-green-500 transition-all duration-100 relative z-10"
                      style={{ height: `${scoreToHeight(comparison.myBestAtTime.score)}%` }}
                    />
                  </div>
                )}

                {/* Bar 3: RIVAL (Red, filled + hollow outline) */}
                {rival && !rival.isThresholdOnly && comparison.rivalAtTime && (
                  <div className="relative w-32 h-full flex flex-col justify-end">
                    {/* Hollow outline (static at final score) */}
                    <div
                      className="absolute bottom-0 w-full border-4 border-red-500 bg-transparent pointer-events-none"
                      style={{ height: `${scoreToHeight(rival.finalScore)}%` }}
                    />
                    {/* Filled bar (grows with current timestamp) */}
                    <div
                      className="w-full bg-red-500 transition-all duration-100 relative z-10"
                      style={{ height: `${scoreToHeight(comparison.rivalAtTime.score)}%` }}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {showDelta && (
            <div className="absolute bottom-8 right-4 z-40 text-right text-xl font-bold">
              {/* TARGET (vs RIVAL) */}
              <div className={comparison.rivalDiff >= 0 ? 'text-white' : 'text-red-500'}>
                TARGET: {comparison.rivalDiff >= 0 ? '+' : ''}
                {comparison.rivalDiff.toLocaleString()}
              </div>
              {/* MYBEST */}
              {myBest && (
                <div className={comparison.myBestDiff >= 0 ? 'text-white' : 'text-red-500'}>
                  MYBEST: {comparison.myBestDiff >= 0 ? '+' : ''}
                  {comparison.myBestDiff.toLocaleString()}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* F2 Notification (appears when pass detected) */}
      {view === 'full' && <F2Notification show={showNotification} countdown={countdown} />}
    </div>
  );
}
