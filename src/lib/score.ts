import { MOD_MULTIPLIERS_SV2 } from "@/lib/mods";

export function normalizeScoreSV2(rawScore: number, playedTokens: string[]): number {
  const multiplier = playedTokens.reduce(
    (product, token) => product * (MOD_MULTIPLIERS_SV2[token] ?? 1),
    1,
  );

  return Math.round(rawScore / multiplier);
}
