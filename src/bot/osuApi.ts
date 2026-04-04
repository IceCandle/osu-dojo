import { DEFAULT_ACCURACY_VARIANT, type AccuracyVariant } from "@/lib/domain";
import { requireAccuracy } from "@/lib/accuracy";

interface LegacyMultiScore {
  userId: number;
  score: number;
  maxCombo: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  pass: boolean;
}

interface LegacyMultiGame {
  id: number;
  beatmapId: number;
  scores: LegacyMultiScore[];
}

interface FetchScoreOptions {
  beatmapId: number;
  userId: number;
  processedGameIds: Set<number>;
  variant?: AccuracyVariant;
  attempts?: number;
  delayMs?: number;
}

export interface NormalizedPlayerMapScore {
  gameId: number;
  beatmapId: number;
  userId: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  passed: boolean;
}

export interface LobbyWithApiFetch {
  fetchFromAPI: () => Promise<unknown>;
}

export async function fetchLatestPlayerMapScore(
  lobby: LobbyWithApiFetch,
  options: FetchScoreOptions,
): Promise<NormalizedPlayerMapScore> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 1_000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const match = (await lobby.fetchFromAPI()) as { games: LegacyMultiGame[] };
    const game = [...match.games]
      .reverse()
      .find(
        (candidate) =>
          candidate.beatmapId === options.beatmapId &&
          !options.processedGameIds.has(candidate.id),
      );

    if (game) {
      const playerScore = game.scores.find(
        (score) => score.userId === options.userId,
      );

      if (playerScore) {
        return normalizePlayerMapScore(
          game,
          playerScore,
          options.variant ?? DEFAULT_ACCURACY_VARIANT,
        );
      }

      lastError = new Error(
        `Match ${game.id} does not include a score for user ${options.userId}.`,
      );
    } else {
      lastError = new Error(
        `No completed multiplayer game found for beatmap ${options.beatmapId}.`,
      );
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error("Unable to fetch multiplayer score.");
}

function normalizePlayerMapScore(
  game: LegacyMultiGame,
  score: LegacyMultiScore,
  variant: AccuracyVariant,
): NormalizedPlayerMapScore {
  return {
    gameId: game.id,
    beatmapId: game.beatmapId,
    userId: score.userId,
    score: score.score,
    accuracy: requireAccuracy(
      {
        count300: score.count300,
        count100: score.count100,
        count50: score.count50,
        countMiss: score.countMiss,
      },
      variant,
    ),
    maxCombo: score.maxCombo,
    count300: score.count300,
    count100: score.count100,
    count50: score.count50,
    countMiss: score.countMiss,
    passed: score.pass,
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
