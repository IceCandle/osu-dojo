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
- **Description:** Replace the single `passConditionType`/`passConditionThreshold` columns with a JSON array of `{ type, threshold }` pairs (AND logic — all must pass). Applies to both per-beatmap conditions (`danBeatmaps`, `mapResults`) and course-level overall conditions (`dans`). Adds two new condition types: `"combo"` (value >= threshold) and `"misses"` (value <= threshold), alongside existing `"acc"` (>=) and `"sv2"` (>=). Touches schema, domain types, judging, formatting, course loader, queries, bot runtime, UI pages, seed JSON, and tests.
- **Affected AC:** AC4
- **Decision:** deferred

### Countdown-gated dan halt, grace period, and interrupted run archive
- **Classification:** important
- **Source:** dan flow plan review and implementation request
- **Description:** Stop the course on first failed map, use the between-map `!mp start 20` countdown itself as the rest window, halt if that queued start does not lead to `matchStarted`, keep the lobby open briefly after completion/abort, and store interrupted runs only when at least one map was completed.
- **Affected AC:** AC2, AC3, AC4, AC5
- **Decision:** inject-now
