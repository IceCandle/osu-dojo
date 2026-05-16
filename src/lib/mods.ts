const SUPPORTED_COURSE_MODS = new Set([
  "EZ",
  "NF",
  "HT",
  "DT",
  "HD",
  "HR",
  "SD",
  "NC",
  "FL",
  "SO",
  "PF",
  "K4",
  "K5",
  "K6",
  "K7",
  "K8",
  "FI",
  "K9",
  "SV2",
  "MR",
]);

export const MOD_MULTIPLIERS_SV2: Readonly<Record<string, number>> = {
  EZ: 0.5,
  NF: 1.0,
  HT: 0.3,
  HD: 1.06,
  HR: 1.1,
  DT: 1.2,
  NC: 1.2,
  FL: 1.12,
  SO: 0.9,
  SD: 1.0,
  PF: 1.0,
};

const ORDERED_COURSE_MODS = [...SUPPORTED_COURSE_MODS].sort(
  (left, right) => right.length - left.length || left.localeCompare(right),
);

export const CANONICAL_MOD_ORDER = [
  "EZ",
  "NF",
  "HT",
  "HD",
  "HR",
  "SD",
  "PF",
  "DT",
  "NC",
  "FL",
  "SO",
  "RX",
  "AP",
  "SV2",
  "FI",
  "RN",
  "MR",
  "K1",
  "K2",
  "K3",
  "K4",
  "K5",
  "K6",
  "K7",
  "K8",
  "K9",
  "CO",
  "TD",
  "AT",
  "CM",
  "TP",
] as const;

const MOD_BITMASK_TOKENS = [
  [1, "NF"],
  [2, "EZ"],
  [4, "TD"],
  [8, "HD"],
  [16, "HR"],
  [32, "SD"],
  [64, "DT"],
  [128, "RX"],
  [256, "HT"],
  [512, "NC"],
  [1024, "FL"],
  [2048, "AT"],
  [4096, "SO"],
  [8192, "AP"],
  [16384, "PF"],
  [32768, "K4"],
  [65536, "K5"],
  [131072, "K6"],
  [262144, "K7"],
  [524288, "K8"],
  [1048576, "FI"],
  [2097152, "RN"],
  [4194304, "CM"],
  [8388608, "TP"],
  [16777216, "K9"],
  [33554432, "CO"],
  [67108864, "K1"],
  [134217728, "K3"],
  [268435456, "K2"],
  [536870912, "SV2"],
  [1073741824, "MR"],
] as const;

export const FREEMOD_PLAYER_ALLOWED: ReadonlySet<string> = new Set(["HD", "HR"]);

export function normalizeCourseMods(mods: string): string {
  const compact = mods.toUpperCase().replace(/[\s,]+/g, "");

  if (compact === "NM") {
    return "";
  }

  return compact;
}

export function parseCourseMods(mods: string): string[] {
  const compact = normalizeCourseMods(mods);

  if (compact === "") {
    return [];
  }

  const tokens: string[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  while (cursor < compact.length) {
    const token = ORDERED_COURSE_MODS.find((candidate) =>
      compact.startsWith(candidate, cursor),
    );

    if (!token) {
      throw new Error(`Unsupported mod string "${mods}".`);
    }

    if (seen.has(token)) {
      throw new Error(`Duplicate mod "${token}" in "${mods}".`);
    }

    seen.add(token);
    tokens.push(token);
    cursor += token.length;
  }

  return tokens;
}

export function validateCourseMods(mods: string): string {
  parseCourseMods(mods);
  return normalizeCourseMods(mods);
}

export function formatModsCanonical(tokens: string[]): string {
  const seen = new Set(tokens.map((token) => token.toUpperCase()));

  return [...seen]
    .sort((left, right) => canonicalModIndex(left) - canonicalModIndex(right))
    .join("");
}

export function formatVisibleCourseModTokens(mods: string): string[] {
  const seen = new Set(
    parseCourseMods(mods).filter((token) => token !== "NF"),
  );

  return [...seen].sort(
    (left, right) => canonicalModIndex(left) - canonicalModIndex(right),
  );
}

export function formatVisibleCourseMods(mods: string): string {
  const tokens = formatVisibleCourseModTokens(mods);

  return tokens.length === 0 ? "NM" : tokens.join("");
}

export function parseModBitmask(value: number | null | undefined): string[] {
  if (value === null || value === undefined || value === 0) {
    return [];
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    return [`UNKNOWN:${String(value)}`];
  }

  const tokens: string[] = [];
  let remaining = value;

  for (const [bit, token] of MOD_BITMASK_TOKENS) {
    if (hasBit(value, bit)) {
      tokens.push(token);
      remaining -= bit;
    }
  }

  const compactTokens = tokens.includes("NC")
    ? tokens.filter((token) => token !== "DT")
    : tokens;

  for (let bit = 1; remaining > 0 && bit <= Number.MAX_SAFE_INTEGER; bit *= 2) {
    if (hasBit(remaining, bit)) {
      compactTokens.push(`UNKNOWN:${bit}`);
      remaining -= bit;
    }
  }

  return sortModTokens(compactTokens);
}

export function validateFreemodPlayerSelection(
  playerSelectedTokens: string[],
): { ok: true } | { ok: false; rejected: string[] } {
  const rejected = sortModTokens(
    playerSelectedTokens.filter((token) => !FREEMOD_PLAYER_ALLOWED.has(token)),
  );

  return rejected.length === 0 ? { ok: true } : { ok: false, rejected };
}

function sortModTokens(tokens: string[]): string[] {
  return [...new Set(tokens)].sort(
    (left, right) => canonicalModIndex(left) - canonicalModIndex(right),
  );
}

function canonicalModIndex(token: string): number {
  const index = (CANONICAL_MOD_ORDER as readonly string[]).indexOf(token);
  return index === -1 ? CANONICAL_MOD_ORDER.length : index;
}

function hasBit(value: number, bit: number) {
  return Math.floor(value / bit) % 2 === 1;
}
