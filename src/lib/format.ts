import type { PassConditionType } from "@/lib/domain";

export function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatCondition(
  type: PassConditionType,
  threshold: number,
): string {
  return type === "acc"
    ? `${formatPercentage(threshold)} accuracy`
    : `${formatInteger(threshold)} ScoreV2`;
}

export function formatConditionValue(
  type: PassConditionType,
  value: number,
): string {
  return type === "acc" ? formatPercentage(value) : formatInteger(value);
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatMods(mods: string): string {
  return mods.trim() === "" ? "NM" : mods;
}
