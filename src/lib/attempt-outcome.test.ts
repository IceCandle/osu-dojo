import { describe, expect, it } from 'vitest';

import { getAttemptOutcome, getAttemptOutcomeDetailed } from '@/lib/attempt-outcome';

describe('getAttemptOutcome', () => {
  it('returns IN_PROGRESS when attempt is in progress', () => {
    expect(
      getAttemptOutcome({
        status: 'IN_PROGRESS',
        isNormalPass: false,
        isGoldPass: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('returns ABANDONED when attempt is abandoned', () => {
    expect(
      getAttemptOutcome({
        status: 'ABANDONED',
        isNormalPass: false,
        isGoldPass: false,
      }),
    ).toBe('ABANDONED');
  });

  it('returns FAILED when attempt is completed without pass flags', () => {
    expect(
      getAttemptOutcome({
        status: 'COMPLETED',
        isNormalPass: false,
        isGoldPass: false,
      }),
    ).toBe('FAILED');
  });

  it('returns PASSED when attempt is completed with a pass flag', () => {
    expect(
      getAttemptOutcome({
        status: 'COMPLETED',
        isNormalPass: true,
        isGoldPass: false,
      }),
    ).toBe('PASSED');

    expect(
      getAttemptOutcome({
        status: 'COMPLETED',
        isNormalPass: false,
        isGoldPass: true,
      }),
    ).toBe('PASSED');
  });
});

describe('getAttemptOutcomeDetailed', () => {
  it('returns IN_PROGRESS when attempt is in progress', () => {
    expect(
      getAttemptOutcomeDetailed({
        status: 'IN_PROGRESS',
        isNormalPass: false,
        isGoldPass: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('returns ABANDONED when attempt is abandoned', () => {
    expect(
      getAttemptOutcomeDetailed({
        status: 'ABANDONED',
        isNormalPass: false,
        isGoldPass: false,
      }),
    ).toBe('ABANDONED');
  });

  it('returns FINISHED_NO_CLEAR when completed without pass flags', () => {
    expect(
      getAttemptOutcomeDetailed({
        status: 'COMPLETED',
        isNormalPass: false,
        isGoldPass: false,
      }),
    ).toBe('FINISHED_NO_CLEAR');
  });

  it('returns PASSED_NORMAL when completed with normal pass', () => {
    expect(
      getAttemptOutcomeDetailed({
        status: 'COMPLETED',
        isNormalPass: true,
        isGoldPass: false,
      }),
    ).toBe('PASSED_NORMAL');
  });

  it('returns PASSED_GOLD when completed with gold pass', () => {
    expect(
      getAttemptOutcomeDetailed({
        status: 'COMPLETED',
        isNormalPass: true,
        isGoldPass: true,
      }),
    ).toBe('PASSED_GOLD');
  });
});
