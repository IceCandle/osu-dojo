# Pivot: Static Courses + OBS Overlay + Public Stats

Updated: 2025-12-18

## Goals

- Replace candidate/ban-heavy flow with a curated static course system.
- Reduce dan addict behaviors by limiting retries in a simple, transparent way.
- Make pacemaker overlays easy to use in OBS (multi-source) and easy to share (public stats).

## Definitions

### Certificate key ("same certificate")

A certificate represents a grade within a system.

- Primary: `(danSystemId, tierInSystem)`
- Scope rule: attempt limits and statistics are applied per certificate key, regardless of course variant.
- Officialness: `DanSystem.isOfficial` is manually curated (admin decision).

### Attempt limit (energy-style)

- Starting a course consumes an attempt immediately.
- Limit is a rolling window: **3 attempts per 24 hours**.
- Enforcement: per user + certificate key.

> Implementation note: use `Attempt.createdAt >= now - 24h` rather than calendar day.

## Course structure

### Variants per certificate

- Number dans: 3 variants (courses)
- Extra: 2 variants

Schema representation: multiple `Dan` rows share the same certificate key `(danSystemId, tierInSystem)` and are distinguished by `Dan.variantIndex` (1-based).

### Shuffle rules

- Normal Number dans have **no boss** map: shuffle the entire list.
- If a course has a boss map (by convention), keep the final map fixed and shuffle only the first `n-1`.

## Overlay (OBS-first)

### Public stats navigation

- Overlay shows a clickable banner/header.
- Clicking it opens a public page with pass statistics and a single "score link" for the whole attempt.

### Course leaderboard

- A public leaderboard exists per course (dan) at `GET /dans/:danId/leaderboard`.
- Ranking metric: **added score with ScoreV2 mod multipliers removed** (so high-multiplier maps don’t overweight the total).

### Multi-source rendering

Support `view=` query param so users can add multiple browser sources in OBS:

- `view=full` (default): current full overlay.
- `view=bars`: only the 3-bar pacemaker visualization.
- `view=delta`: only the delta readout.

This enables OBS scene layout without requiring an in-overlay drag editor.

### localStorage

Persist overlay settings in browser:

- `mode` (rival mode)
- `ip` (tosu host)

## Public attempt stats page

Route:

- `GET /attempts/:attemptId/stats` (public page)

Content:

- Shows aggregates for the certificate key: total completed attempts, pass count, gold pass count, pass/gold rate.
- Shows a list of recent completed attempts with usernames.
- Includes the selected attempt’s `historyLink` as the canonical "score link".

Privacy:

- Usernames are shown.
- Leaderboards are separate (see above).

## Reference replays (no synthetic generation)

Principle:

- Do not generate synthetic pacemaker replays.
- Creators/admin upload pass/gold reference replays.

Current schema already supports:

- `Dan.passReplayId`
- `Dan.goldClearReplayId`

Wiring work (later): admin upload/attach endpoints + UI.

## Implementation order

1. Public stats page + overlay banner + multi-source `view=` + localStorage.
2. Attempt-limit pivot (rolling 24h per certificate key).
3. Static course pivot (remove candidate/ban logic + shuffle rules + course variants).
4. Replay upload wiring (admin tools).
