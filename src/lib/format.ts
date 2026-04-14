import type { DanScoreModel, PassConditionType } from "@/lib/domain";

export function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function kebabizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

export function formatConditionCompact(
  type: PassConditionType,
  threshold: number,
): string {
  return type === "acc"
    ? `${formatPercentage(threshold)}+`
    : `${formatInteger(threshold)}+ score`;
}

export function formatConditionValue(
  type: PassConditionType,
  value: number,
): string {
  return type === "acc" ? formatPercentage(value) : formatInteger(value);
}

export function formatMods(mods: string): string {
  return mods.trim() === "" ? "+NM" : `+${mods}`;
}

export function formatScoreModel(scoreModel: DanScoreModel): string {
  return scoreModel === "scorev1" ? "ScoreV1" : "ScoreV2";
}
