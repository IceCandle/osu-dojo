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

export function formatConditionCompact(condition: {
  type: PassConditionType;
  threshold: number;
}): string {
  if (condition.type === "accuracy" || condition.type === "courseAccuracy") {
    return `${formatPercentage(condition.threshold)}+`;
  }

  if (condition.type === "score" || condition.type === "totalScore") {
    return `${formatInteger(condition.threshold)}+ score`;
  }

  if (condition.type === "maxCombo") {
    return `${formatInteger(condition.threshold)}+ combo`;
  }

  return `${formatInteger(condition.threshold)}- miss`;
}

export function formatConditionValue(
  type: PassConditionType,
  value: number,
): string {
  return type === "accuracy" || type === "courseAccuracy"
    ? formatPercentage(value)
    : formatInteger(value);
}

export function formatConditionCompactAscii(condition: {
  type: PassConditionType;
  threshold: number;
}): string {
  if (condition.type === "missCount" || condition.type === "totalMissCount") {
    return `<=${formatInteger(condition.threshold)} miss`;
  }

  return formatConditionCompact(condition);
}

export function formatScoreModel(scoreModel: DanScoreModel): string {
  return scoreModel === "scorev1" ? "ScoreV1" : "ScoreV2";
}
