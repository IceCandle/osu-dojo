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

const ORDERED_COURSE_MODS = [...SUPPORTED_COURSE_MODS].sort(
  (left, right) => right.length - left.length || left.localeCompare(right),
);

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
