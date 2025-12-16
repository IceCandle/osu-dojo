/**
 * Type declarations for osu-parser
 * Package: https://github.com/nojhamster/osu-parser
 */

declare module 'osu-parser' {
  export interface Replay {
    mode: number;
    version: number;
    beatmap_md5: string;
    player_name: string;
    replay_md5: string;
    count_300: number;
    count_100: number;
    count_50: number;
    count_geki: number;
    count_katu: number;
    count_miss: number;
    score: number;
    max_combo: number;
    perfect_combo: boolean;
    mods: number;
    life_bar: string;
    timestamp: string;
    replay_length: number;
    replay_data: Array<{
      time_since_previous_action: number;
      x: number;
      y: number;
      keys_pressed: number;
    }>;
  }

  export interface HitObject {
    startTime: number;
    type: number;
    x: number;
    y: number;
    endTime?: number;
  }

  export interface Beatmap {
    nbCircles: number;
    nbSliders: number;
    nbSpinners: number;
    title: string;
    artist: string;
    creator: string;
    version: string;
    approachRate: number;
    circleSize: number;
    hpDrain: number;
    overallDifficulty: number;
    sliderMultiplier: number;
    sliderTickRate: number;
    hitObjects: HitObject[];
    timingPoints: Array<{
      offset: number;
      beatLength: number;
      velocity: number;
      timingSignature: number;
      sampleSetId: number;
      sampleVolume: number;
      timingChange: boolean;
      kiaiTimeActive: boolean;
    }>;
  }

  export function parseReplay(buffer: Buffer): Replay;
  export function parseBeatmap(content: string): Beatmap;
}
