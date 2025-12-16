# Recovery Strategy (Phase 1.5)

This document captures the design notes that previously lived inline in `src/bot/recovery.ts`.

## Goal

On bot startup, reconcile what happened in an osu! multiplayer lobby while the bot was down.

## Data Sources

- Redis lobby state (`lobby:{matchId}`): last known progress and ordered `mapDbIds`
- Database (`Attempt`, `AttemptScore`): authoritative stored scores/progress
- osu! API v2 match history: best-effort reconstruction of games played

## Proposed Flow

1. Fetch match history from osu! API v2
   - Endpoint: `GET /api/v2/matches/{matchId}`
   - Authentication: OAuth token (requires user consent)
   - Response includes: `match.events[]` with all games played

2. Extract game events
   - Filter: `match.events.filter(e => e.detail.type === 'other')`
   - Each event has: `event.game.scores[]` with player scores

3. Load existing `AttemptScore` records
   - Query: `prisma.attemptScore.findMany({ where: { attemptId }, orderBy: { playedAt: 'asc' } })`

4. Compare API scores with DB records
   - Match by: beatmap id plus a timestamp tolerance window
   - Identify missing scores (present in API, absent in DB)

5. Return missing scores for backfilling
   - Structure: `{ beatmapId, score, accuracy, combo, passed, count300, count100, count50, countMiss }`
   - Insert into `AttemptScore`

## Known Risks / Limitations

- Match history retention is limited (often ~24h)
- Timestamp-matching tolerances can be flaky (clock skew, server delays)
- Requires an OAuth token with enough scope to access match history

## Error Handling Ideas

- `404` match not found → likely too old → abandon recovery for that lobby
- `401` unauthorized → require re-auth or skip reconciliation
- rate limits → exponential backoff

## Implementation Note

The current `reconcileMatchHistory` is a best-effort stub. Any “high-stakes” use should avoid relying solely on loose date-math; prefer stable identifiers (game id, event id) if available from the API response.
