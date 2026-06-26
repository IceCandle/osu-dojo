import type { DanSystemStatus } from "@/lib/domain";

export const MAX_QUERY_LENGTH = 100;

export type SystemHit = {
  name: string;
  nameKey: string;
  status: DanSystemStatus;
};

export type CourseHit = {
  name: string;
  nameKey: string;
  systemName: string;
  systemNameKey: string;
};

export type PlayerHit = {
  userId: number;
  username: string;
  avatarUrl: string;
  country: null;
  gameMode: "osu";
};

export type SearchResults = {
  systems: SystemHit[];
  courses: CourseHit[];
  players: PlayerHit[];
};

export type CatalogFilters = {
  officialOnly: boolean;
};

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidQuery(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_QUERY_LENGTH;
}

export function emptySearchResults(): SearchResults {
  return { systems: [], courses: [], players: [] };
}

export function parseCatalogFilters(searchParams: URLSearchParams): CatalogFilters {
  const official = searchParams.get("official");

  return {
    officialOnly: official === "1" || official === "true",
  };
}
