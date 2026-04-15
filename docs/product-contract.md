# Product Contract: osu!dojo

This document is the current product contract: shipped behavior as it exists today, not a future target.

## Goal

A working IRC bot that runs osu! dan courses in automated multiplayer rooms, judges pass/fail, stores results, and a minimal website that lists courses and recent results.

## Architecture

- **Runtime:** Node.js 20+
- **Framework:** Next.js 14+ App Router for the website
- **Bot process:** Separate long-running Node process (`src/bot/`) using `bancho.js` for osu! IRC/multiplayer
- **Database:** SQLite via Drizzle ORM (single file, zero ops at current scope)
- **Structure:** Single Next.js project with bot as a separate entry point (`pnpm bot`)
- **Credentials:** osu! IRC username, IRC password, and legacy API key in `.env`

## Domain Model

```
DanSystem (id, name, slug, description)
  has many Dan (id, name, courseSlug, danSystemId, ordinal, scoreModel: "scorev1"|"scorev2")
    has many DanBeatmap (id, danId, beatmapId, mods, passCondition: {type: "acc"|"score", threshold: number}, ordinal)

Result (id, userId, danId, passed, timestamp, matchId?)
  has many MapResult (id, resultId, gameId?, beatmapId, score, accuracy, passed)
```

- A Dan is a course: play N maps in sequence, each with its own pass condition.
- A DanSystem groups related dans, such as "test" or "tr1ple".
- `slug` and `courseSlug` remain internal seed/database identifiers. Public commands and URLs use display-name keys instead.

## Public Name Keys

- Players address systems and courses by display-name keys, not internal slugs.
- A name key is derived from the display name by trimming, lowercasing, and replacing whitespace runs with `-`.
- Display names used for systems and courses must match `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`.
- Course loading hard-fails when two systems produce the same system name key, or when two courses within a system produce the same course name key.
- Old slug-based commands and URLs are not supported as fallbacks.

## Public Routes

- `/` — home and system overview.
- `/dan` — dan catalog.
- `/dan/[systemNameKey]?course=<courseNameKey>` — dan system detail page with all courses rendered sequentially and an optional selected-course anchor.

## Acceptance Criteria

### AC1: Bot Start Flow

- Player sends `!dojo start <system-name> <course-name>` via DM to the bot IRC account, where both arguments are display-name keys.
- Bot creates a multiplayer room titled `osu!dojo: <dan_name>`.
- Bot invites the player. Player joins.
- If either name key is invalid or unknown, bot replies with an error message.

### AC2: Course Sequencing

- Bot loads the dan definition from DB.
- Sets the first beatmap with correct mods.
- After each map completes, automatically advances to the next after rest time (default: 20s).
- After the last map, the course is complete.

### AC3: Result Ingestion

- After each map finishes, bot collects the player's score from match results.
- Stores: `{userId, danId, beatmapId, score, accuracy, passed, timestamp}`.

### AC4: Pass/Fail Judgment

- Per-map: compare accuracy or score against the threshold in DanBeatmap.
- Overall: dan is passed only if all maps are passed and the overall score/accuracy passes the course criteria.
- Bot announces per-map result and final result in multiplayer chat.

### AC5: Website

- `/` lists dan systems and their courses.
- `/dan` lists dan systems in catalog form.
- `/dan/[systemNameKey]` renders all courses for that system with beatmap lists, pass conditions, integrated leaderboards, and `?course=<courseNameKey>` anchor jumps.
- No auth required. Read-only. SSR with server components.

## Demo Scenario

1. Seed DB with sample dan system "test" containing dan "1st" with 2 beatmaps.
2. Start bot process: `pnpm bot`.
3. Player DMs bot: `!dojo start test 1st`.
4. Bot creates room, invites player, sets first map.
5. Player plays map 1. Bot reads score, judges pass/fail, announces `Map 1: PASS (97.2% >= 95%)`.
6. Bot sets map 2. Repeat.
7. After map 2, bot announces `1st: PASS` or `fail (1,050,000 vs 1,240,000)`.
8. Result stored in DB.
9. Visit `http://localhost:3000/dan/test?course=1st` to see the course and its latest result.

## Deferred Direction

Deferred work is tracked in `docs/kanban.md`; aspirational direction is summarized in `docs/roadmap.md`. Pacemaker overlays and real-time leaderboards are not current product direction. osu!dojo's near-term value is automated forced-start lobby flow, not recreating tosu or osu!collector-style surfaces.
