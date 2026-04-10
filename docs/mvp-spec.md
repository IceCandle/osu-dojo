# MVP Spec: osu!dojo

## Goal

A working IRC bot that runs osu! dan courses in automated multiplayer rooms, judges pass/fail, stores results, and a minimal website that lists courses and recent results.

## Architecture

- **Runtime:** Node.js 20+
- **Framework:** Next.js 14+ (App Router) — website + API routes
- **Bot process:** Separate long-running Node process (`src/bot/`) using `bancho.js` for osu! IRC/multiplayer
- **Database:** SQLite via Drizzle ORM (single file, zero ops for MVP)
- **Structure:** Single Next.js project with bot as a separate entry point (`pnpm bot`)
- **Credentials:** osu! IRC username + password in `.env` (use personal account for dev)

## Domain Model

```
DanSystem (id, name, slug, description)
  has many Dan (id, name, slug, danSystemId, ordinal, scoreModel: "scorev1"|"scorev2")
    has many DanBeatmap (id, danId, beatmapId, mods, passCondition: {type: "acc"|"score", threshold: number}, ordinal)

Result (id, userId, danId, passed, timestamp, matchId?)
  has many MapResult (id, resultId, gameId?, beatmapId, score, accuracy, passed)
```

- A Dan is a course: play N maps in sequence, each with its own pass condition.
- A DanSystem groups related dans (e.g., "test", "tr1ple").
- Dan IDs use slugs (e.g., `test-1dan`) for human-readable IRC commands.

## Acceptance Criteria

### AC1: Bot Start Flow
- Player sends `!dojo start <dan_slug>` via DM to the bot IRC account.
- Bot creates a multiplayer room titled `osu!dojo: <dan_name>`.
- Bot invites the player. Player joins.
- If slug is invalid, bot replies with an error message.

### AC2: Course Sequencing
- Bot loads the dan definition from DB.
- Sets the first beatmap with correct mods.
- After each map completes, automatically advances to the next after rest time (default: 20s).
- After the last map, the course is complete.

### AC3: Result Ingestion
- After each map finishes, bot collects the player's score from match results (via bancho.js match events).
- Stores: `{userId, danId, beatmapId, score, accuracy, passed, timestamp}`.

### AC4: Pass/Fail Judgment
- Per-map: compare accuracy or score against the threshold in DanBeatmap.
- Overall: dan is passed only if all maps are passed and the overall score/accuracy passes the course criteria.
- Bot announces per-map result and final result in multiplayer chat.

### AC5: Website
- `/` — list of dan systems and their dans.
- `/dan/[systemSlug]` — dan system detail: all courses rendered sequentially with beatmap lists, pass conditions, integrated leaderboards, and `#course=<courseSlug>` anchor jumps.
- No auth required. Read-only. SSR with server components.

## Demo Scenario

1. Seed DB with sample dan system "test" containing dan "test-1" (slug: `test-1dan`) with 2 beatmaps.
2. Start bot process: `pnpm bot`.
3. Player DMs bot: `!dojo start test-1dan`.
4. Bot creates room, invites player, sets first map.
5. Player plays map 1. Bot reads score, judges pass/fail, announces "Map 1: PASS (97.2% >= 95%)".
6. Bot sets map 2. Repeat.
7. After map 2, bot announces "test-1: PASS" or "FAIL (1,050,000 vs 1,240,000)".
8. Result stored in DB.
9. Visit `http://localhost:3000/dan/test#course=test-1dan` — see the course and its latest result.

## Non-Goals (MVP)

- Replay verification, anti-cheat
- Rankings, leaderboards, rivals
- Banner image generation
- Custom dan system creation UI
- Admin panel, user auth
- Recovery from bot crashes
- Production deployment, CDN, caching
- Pacemaker/OBS overlay
