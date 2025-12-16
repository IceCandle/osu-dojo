export interface ScoreTimestamp {
  time: number; // ms from start
  score: number; // cumulative score
  combo: number; // combo at this point
  accuracy: number; // accuracy percentage (0-100)
}

/**
 * Get interpolated score at specific timestamp
 * Uses binary search for O(log n) lookup
 */
export function getScoreAtTime(timeSeries: ScoreTimestamp[], targetTime: number): ScoreTimestamp {
  if (timeSeries.length === 0) {
    return { time: targetTime, score: 0, combo: 0, accuracy: 100 };
  }

  // Binary search for closest timestamps
  let left = 0;
  let right = timeSeries.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (timeSeries[mid].time < targetTime) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // Handle edge cases
  if (left === 0) return timeSeries[0];
  if (left >= timeSeries.length) return timeSeries[timeSeries.length - 1];

  // Linear interpolation between two closest points
  const before = timeSeries[left - 1];
  const after = timeSeries[left];

  if (after.time === before.time) return after;

  const progress = (targetTime - before.time) / (after.time - before.time);

  return {
    time: targetTime,
    score: Math.floor(before.score + (after.score - before.score) * progress),
    combo: Math.floor(before.combo + (after.combo - before.combo) * progress),
    accuracy: before.accuracy + (after.accuracy - before.accuracy) * progress,
  };
}
