'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getScoreAtTime, type ScoreTimestamp } from '@/lib/replay-parser';
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

/**
 * 3-Bar Pacemaker Overlay
 * YOU (blue) | MY-BEST (green) | RIVAL (red)
 */
export default function OverlayPage() {
  const { attemptId } = useParams();
  const searchParams = useSearchParams();

  // State
  const [myBest, setMyBest] = useState<TimeSeriesData | null>(null);
  const [rival, setRival] = useState<TimeSeriesData | null>(null);
  const [liveScore, setLiveScore] = useState<LiveScore | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mapValidationError, setMapValidationError] = useState<string | null>(null);
  const [lastState, setLastState] = useState<number>(0);
  const [clearThreshold, setClearThreshold] = useState<number>(0);
  const [goldThreshold, setGoldThreshold] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);

  // F2 Notification (for replay saving)
  const { showNotification, countdown, triggerF2Notification } = useF2Notification();

  // Config
  const tosuIP = searchParams.get('ip') || 'localhost';
  const initialRivalMode = (searchParams.get('mode') || 'clear') as RivalMode;
  const [rivalMode, setRivalMode] = useState<RivalMode>(initialRivalMode);
  const [modeChangeNotification, setModeChangeNotification] = useState<string | null>(null);
  const f2CountdownDuration = parseInt(searchParams.get('f2Countdown') || '5', 10); // Adjustable countdown (default: 5s)

  /**
   * 0. Keyboard Controls - Cycle Rival Mode
   */
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        setRivalMode(prev => {
          const modes: RivalMode[] = ['clear', 'gold-clear'];
          const currentIndex = modes.indexOf(prev);
          const nextMode = modes[(currentIndex + 1) % modes.length];

          // Show notification
          setModeChangeNotification(`Rival: ${nextMode}`);
          setTimeout(() => setModeChangeNotification(null), 2000);

          return nextMode;
        });
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
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
    const ws = new WebSocket(`ws://${tosuIP}:24050/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[tosu] Connected');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: TosuData = JSON.parse(event.data);

        // Detect map completion
        if (lastState === 2 && data.gameplay.state === 7) {
          console.log('[Overlay] Map completed, sending live stats');

          if (liveScore) {
            // Check if player passed (score >= clear threshold)
            const passed = clearThreshold > 0 && liveScore.score >= clearThreshold;

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
                sliderbreaks: liveScore.sliderbreaks,
                maxCombo: liveScore.maxCombo,
                count300: liveScore.count300,
                count100: liveScore.count100,
                count50: liveScore.count50,
                countMiss: liveScore.countMiss,
              }),
            }).catch(err => console.error('[Overlay] Error posting live stats:', err));
          }
        }

        setLastState(data.gameplay.state);

        // Only process when playing
        if (data.gameplay.state !== 2) {
          setIsPlaying(false);
          return;
        }

        setIsPlaying(true);

        // Beatmap ID validation
        if (rival && data.menu.bm.id !== rival.beatmapId) {
          setMapValidationError(
            `Wrong map! Expected: ${rival.beatmapId}, Got: ${data.menu.bm.id}`
          );
          return;
        }

        if (mapValidationError) {
          setMapValidationError(null);
        }

        // Update live score
        setLiveScore({
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
        });
      } catch (error) {
        console.error('[tosu] Parse error:', error);
      }
    };

    ws.onerror = () => setWsConnected(false);
    ws.onclose = () => setWsConnected(false);

    return () => ws.close();
  }, [rival, mapValidationError, tosuIP, lastState, liveScore, attemptId, clearThreshold, triggerF2Notification, f2CountdownDuration]);


  /**
   * 4. Calculate interpolated scores at current timestamp
   */
  const comparison = (() => {
    if (!liveScore || !isPlaying) return null;

    const currentTime = liveScore.time;

    // MY-BEST score at current time
    const myBestAtTime = myBest && !myBest.isThresholdOnly
      ? getScoreAtTime(myBest.timeSeries, currentTime)
      : null;

    // RIVAL score at current time
    const rivalAtTime = rival && !rival.isThresholdOnly
      ? getScoreAtTime(rival.timeSeries, currentTime)
      : null;

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
  return (
    <div className="relative h-screen w-screen bg-transparent overflow-hidden">
      {/* Connection Status */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-white text-sm">
          {wsConnected ? 'tosu ✓' : 'tosu ✗'}
        </span>
      </div>

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
            <p className="text-xs text-gray-600 mt-2">Press 'R' to cycle rival mode</p>
          </div>
        </div>
      )}

      {/* Playing State - 3 Vertical Bars */}
      {isPlaying && liveScore && comparison && (
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

          {/* Score Differences (Right-aligned, above baseline) */}
          <div className="absolute bottom-8 right-4 z-40 text-right text-xl font-bold">
            {/* TARGET (vs RIVAL) */}
            <div className={comparison.rivalDiff >= 0 ? 'text-white' : 'text-red-500'}>
              TARGET: {comparison.rivalDiff >= 0 ? '+' : ''}{comparison.rivalDiff.toLocaleString()}
            </div>
            {/* MYBEST */}
            {myBest && (
              <div className={comparison.myBestDiff >= 0 ? 'text-white' : 'text-red-500'}>
                MYBEST: {comparison.myBestDiff >= 0 ? '+' : ''}{comparison.myBestDiff.toLocaleString()}
              </div>
            )}
          </div>
        </>
      )}

      {/* F2 Notification (appears when pass detected) */}
      <F2Notification show={showNotification} countdown={countdown} />
    </div>
  );
}
