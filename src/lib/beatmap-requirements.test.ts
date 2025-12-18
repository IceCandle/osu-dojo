import { describe, it, expect } from 'vitest';

import {
  evaluateBeatmapRequirements,
  type BeatmapRequirementConfig,
} from './beatmap-requirements';

describe('Beatmap Requirements', () => {
  const standardMap: BeatmapRequirementConfig = {
    requiredScore: BigInt(700000),
    goldClearScore: BigInt(900000),
    requiredAccuracy: 95.0,
    maxMisses: 10,
  };

  it('passes normal clear correctly', () => {
    const play = {
      score: BigInt(750000),
      accuracy: 96.0,
      combo: 500,
      countMiss: 5,
    };

    const result = evaluateBeatmapRequirements(standardMap, play, 'normal');
    expect(result.met).toBe(true);
    expect(result.failed).toHaveLength(0);
  });

  it('fails if accuracy is too low', () => {
    const play = {
      score: BigInt(950000), // High score
      accuracy: 92.0, // But low acc
      combo: 500,
      countMiss: 0,
    };

    const result = evaluateBeatmapRequirements(standardMap, play, 'normal');
    expect(result.met).toBe(false);
    expect(result.failed).toContain('accuracy');
  });

  it('checks gold requirements', () => {
    const play = {
      score: BigInt(800000), // Between normal and gold
      accuracy: 99.0,
      combo: 500,
      countMiss: 0,
    };

    // Should pass normal
    expect(evaluateBeatmapRequirements(standardMap, play, 'normal').met).toBe(true);

    // Should fail gold (score too low)
    const goldResult = evaluateBeatmapRequirements(standardMap, play, 'gold');
    expect(goldResult.met).toBe(false);
    expect(goldResult.failed).toContain('score');
  });
});
