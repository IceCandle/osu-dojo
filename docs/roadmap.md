# Roadmap

This is an aspirational direction pin, not committed scope. Current scope stays in `docs/product-contract.md`; queued work stays in `docs/kanban.md`.

## Vision

osu!dojo's value is automated forced-start dan lobby flow: a player requests a course, the bot creates and runs the multiplayer room, and the site records the result. The project should not drift into recreating tosu, osu!collector, or generic real-time leaderboard surfaces.

## Phase 1: Current Shipped Scope

- Automated dan lobbies through Bancho IRC. Source: `docs/product-contract.md` AC1-AC2.
- osu!standard stable multiplayer score ingestion and judgment. Source: `docs/product-contract.md` AC3-AC4.
- Read-only course and result catalog at `/`, `/dan`, and `/dan/[systemNameKey]?course=<courseNameKey>`. Source: `docs/product-contract.md` AC5.

## Phase 2: Near-Term Hardening

- Bot reliability improvements such as clearer abort reasons, score-resolution diagnostics, restart-safe manual checks, and command/help consistency.
- Course authoring guide and validation checklist. Source: `docs/kanban.md`.
- Per-beatmap freemod course field. Source: `docs/kanban.md`.
- Multiple pass conditions per map/course. Source: `docs/kanban.md`.
- `!ready` skip-rest command for target players between maps. Source: `docs/kanban.md`.

## Phase 3: Judgment and Proof Policy

- Multi-ruleset and lazer accuracy support through an explicit score-interpretation layer. Source: `docs/kanban.md`.
- Mode-specific judgment counters behind normalized score stats. Source: `docs/kanban.md`.
- Staff proof review policy decision for replay files or handcam video. Source: `docs/kanban.md`.

## Phase 4: Larger Product Expansion

- Lazer/API v2 room-control research before implementation.
- Dynamic profile banner generation after hosting, verification URL, abuse handling, and proof semantics are defined. Source: `docs/kanban.md`.
- Custom course creation UI after auth, ownership, moderation, validation, and persistence decisions are explicit. Source: `docs/kanban.md`.

## Not Current Direction

- Pacemaker overlays.
- Real-time leaderboard surfaces.

Do not reopen these without a new problem statement. The current product direction is bot-run course attempts and recorded outcomes, not live telemetry.
