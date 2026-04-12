# Change Queue

New ideas and scope changes go here. Do NOT inject them into active work.

## Template

```
### <Short title>
- **Classification:** blocker | important | optional
- **Source:** <who/what surfaced this>
- **Description:** <1-2 sentences>
- **Affected AC:** <which acceptance criteria, or "none">
- **Decision:** pending | inject-now | deferred | rejected
```

## Decision Rules

**Inject now** (interrupt current work):
- Blocker: current AC literally cannot pass without this.
- Security/privacy: credential leak, data exposure.
- Invalid assumption: an external API doesn't work the way we assumed.

**Defer** (everything else):
- "Nice to have" improvements.
- Refactors that don't fix a failing AC.
- New features not in mvp-spec.md.
- Performance optimizations (we have 1 concurrent user).

## Queue

### Multi-ruleset and lazer accuracy support
- **Classification:** optional
- **Source:** implementation accuracy review
- **Description:** MVP accuracy judgment is intentionally scoped to osu!standard stable multiplayer scores. Support for other rulesets or lazer-specific score semantics should be added later through an explicit score-interpretation layer, not by assuming the same formula.
- **Affected AC:** AC3, AC4
- **Decision:** deferred

### Per-beatmap freemod course field
- **Classification:** optional
- **Source:** plan review for multiplayer automation
- **Description:** Some dan courses may want fixed mods on most maps and freemod on tiebreaker-style maps, but adding a `freemod` field expands the course data model beyond the frozen MVP. If we add it later, it should use `bancho.js`'s `setMods(mods, freemod)` shape instead of treating freemod like a normal mod token.
- **Affected AC:** AC2
- **Decision:** deferred

### Multiple pass conditions per map/course

- **Classification:** optional
- **Source:** feature request
- **Description:** Replace the single `passConditionType`/`passConditionThreshold` columns with a JSON array of `{ type, threshold }` pairs (AND logic — all must pass). Applies to both per-beatmap conditions (`danBeatmaps`, `mapResults`) and course-level overall conditions (`dans`). Adds two new condition types: `"combo"` (value >= threshold) and `"misses"` (value <= threshold), alongside existing `"acc"` (>=) and `"score"` (>=). Touches schema, domain types, judging, formatting, course loader, queries, bot runtime, UI pages, seed JSON, and tests.
- **Affected AC:** AC4
- **Decision:** deferred

### Skip rest between maps (!ready command)
- **Classification:** optional
- **Source:** design discussion — forced start is the core value prop, forced wait is not
- **Description:** During `between_maps` or `countdown` status, the target player can send `!ready` in lobby chat to skip the remaining countdown and start the next map immediately. Bot cancels the countdown timer, says "Starting now!", and calls `startMatchAfterCountdown`. Ignored if sender is not the target player or run is not in a waiting state. No schema/DB changes needed — one new message handler in `setupLobbyListeners` guarded by `isWaitingToStart(run) && isTargetPlayer(sender, run)`.
- **Affected AC:** none
- **Decision:** deferred

### Mode-specific judgment counters
- **Classification:** optional
- **Source:** feature request
- **Description:** Some courses may want judgments that only exist in specific rulesets or score payloads, such as mania 200s or slider-break-adjacent signals. This should be added behind an explicit score-stat normalization layer because the current stable multiplayer ingestion only stores `300/100/50/miss`, combo, and score, and some requested judgments may not exist as first-class API fields.
- **Affected AC:** AC3, AC4
- **Decision:** deferred

### Current product contract refresh
- **Classification:** important
- **Source:** team development readiness review
- **Description:** Replace or revise outdated MVP wording so docs match the current command syntax, route shape, non-goals, and team ownership boundaries. See `docs/team-development-plan.md`.
- **Affected AC:** all
- **Decision:** pending

### Course authoring guide and validation checklist
- **Classification:** important
- **Source:** team development readiness review
- **Description:** Document how to add real course JSON safely, including slug conventions, optional metadata behavior, validation errors, and app/course smoke-check steps before introducing any write UI.
- **Affected AC:** AC2, AC5
- **Decision:** pending

### Staff proof review policy
- **Classification:** optional
- **Source:** product scope review
- **Description:** Decide whether staff replay-file or handcam-video review belongs in this product. Default assumption is no automated pause detection and no replay-based verification pipeline because replays are local/SV2-limited and staff adjudication may conflict with the automated-bot goal.
- **Affected AC:** none
- **Decision:** pending

### Dynamic profile banner generation
- **Classification:** optional
- **Source:** advanced automation roadmap
- **Description:** Explore generated pass banners only after hosting, verification URL, abuse handling, and "cosmetic vs official proof" semantics are defined.
- **Affected AC:** none
- **Decision:** deferred

### Custom course creation UI
- **Classification:** optional
- **Source:** advanced automation roadmap
- **Description:** Add a write UI for user-created courses only after auth, ownership, moderation, validation, and persistence decisions are explicit.
- **Affected AC:** none
- **Decision:** deferred
