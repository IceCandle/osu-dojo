import { SCOREV2_MOD_MULTIPLIERS } from '@/lib/scoring';

const MULTIPLIER_SCALE = 10_000n;

function powBigInt(base: bigint, exp: number): bigint {
  let result = 1n;
  for (let i = 0; i < exp; i++) result *= base;
  return result;
}

function multiplierToScaledInt(multiplier: number): bigint {
  // Represent multiplier with 4 decimal digits of precision.
  // Example: 1.06 -> 10600
  return BigInt(Math.round(multiplier * Number(MULTIPLIER_SCALE)));
}

export function removeScoreV2ModMultiplier(score: bigint, mods: string[]): bigint {
  // osu! ScoreV2 applies mod multiplier to the final score.
  // We remove that by dividing by the multiplier product.
  // NOTE: Uses 4-decimal fixed-point approximation to keep BigInt math.
  const factors: bigint[] = [];

  for (const rawMod of mods) {
    const mod = rawMod.toUpperCase();
    const mult = SCOREV2_MOD_MULTIPLIERS[mod];

    if (mult === undefined) continue;
    if (mult === 1.0) continue;

    factors.push(multiplierToScaledInt(mult));
  }

  if (factors.length === 0) return score;

  let scaledProduct = 1n;
  for (const f of factors) scaledProduct *= f;

  const scalePow = powBigInt(MULTIPLIER_SCALE, factors.length);

  // score / (scaledProduct / scalePow) == score * scalePow / scaledProduct
  const numerator = score * scalePow;
  return (numerator + scaledProduct / 2n) / scaledProduct; // rounded
}
