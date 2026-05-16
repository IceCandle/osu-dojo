import { MOD_MULTIPLIERS_SV2 } from "@/lib/mods";

export function computeAdjustedScore(rawScore: number, playedTokens: readonly string[]) {
  return Math.round(rawScore / multiplierProduct(playedTokens));
}

export function rawTargetForAdjustedRemaining(
  remainingAdjusted: number,
  modTokens: readonly string[],
) {
  if (remainingAdjusted <= 0) {
    return 0;
  }

  const canonicalTokens = canonicalizeTokens(modTokens);
  const multiplier = multiplierProduct(canonicalTokens);
  const estimate = Math.max(0, Math.ceil(multiplier * (remainingAdjusted - 0.5)));

  if (computeAdjustedScore(estimate, canonicalTokens) < remainingAdjusted) {
    return estimate + 1;
  }

  if (
    estimate > 0 &&
    computeAdjustedScore(estimate - 1, canonicalTokens) >= remainingAdjusted
  ) {
    return estimate - 1;
  }

  return estimate;
}

function multiplierProduct(tokens: readonly string[]) {
  return canonicalizeTokens(tokens).reduce(
    (product, token) => product * (MOD_MULTIPLIERS_SV2[token] ?? 1),
    1,
  );
}

function canonicalizeTokens(tokens: readonly string[]) {
  return [...new Set(tokens.map((token) => token.toUpperCase()))];
}
