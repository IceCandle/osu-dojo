# Kanban

This board is the source of truth for epic status. New work starts in Backlog, moves to Next only when it has a clear owner and verifier shape, and reaches Released only when its verifier is passing on the current branch.

Card IDs are stable. Moving a card between sections does not renumber it. If two PRs move cards at the same time, the person merging resolves the board conflict by preserving both card movements and stable IDs.

Cross-lane work uses a stable `EP-` parent card plus one sub-card per affected lane. The parent card uses Lane `Cross-lane`, lists its child cards, and owns shared-boundary coordination for files such as `src/lib/domain.ts` or `src/db/schema.ts`; sub-cards add `Parent: [EP-xx]` and own their lane outcome. Parent cards use the same `#### [ID]` heading shape as every other card and should be placed immediately before their children, without extra visual grouping headings.

## Backlog

#### [JD-10] Multi-ruleset and lazer accuracy support

- Lane: Judgment
- Owner: Unassigned
- Priority: normal
- Summary: Add an explicit score-interpretation layer for stable osu!standard, osu!taiko, osu!catch/ctb, osu!mania, and lazer osu!standard score semantics.
- Done when: Current stable osu!standard scoring remains compatible, and normalization rules are documented per target ruleset/source before those normalized stats are consumed by judgment.
- Verifier: TBD.

#### [CD-10] Per-beatmap freemod course field

- Lane: Course Data
- Owner: Unassigned
- Priority: normal
- Summary: Allow selected beatmaps to use freemod without treating freemod as a normal mod token.
- Done when: Course data, validation, bot lobby setup, and tests cover fixed-mod and freemod maps.
- Verifier: TBD.

#### [EP-01] Multiple pass conditions per map/course

- Lane: Cross-lane
- Owner: Unassigned
- Priority: normal
- Summary: Support multiple AND-combined pass conditions end-to-end without making one specialist own every affected lane.
- Shared boundaries: `src/lib/domain.ts` condition-list type shape, and `src/db/schema.ts` if storage changes are needed. Coordinated here; concrete edits carried by [CD-13].
- Child cards: [JD-11], [CD-13], [BR-13], [WC-12], [DP-26]
- Done when: All child cards are Released and the integrated verifier passes.
- Verifier: An integrated condition-list test path - a seeded multi-condition course exercised through `tests/course-loader.test.ts`, `tests/accuracy.test.ts`, `tests/bot.test.ts`, and `tests/web-routes.test.ts`. Credential-gated `pnpm bot:dev <system-name> <course-name>` is optional.

#### [JD-11] Condition-list judging

- Parent: [EP-01]
- Lane: Judgment
- Owner: Unassigned
- Priority: normal
- Summary: Evaluate AND-combined pass condition lists in `src/lib/judging.ts` against per-map and per-course thresholds.
- Done when: Judging supports condition lists with tests for all-pass, any-fail, and mixed-metric cases. Domain type shape consumed from [CD-13].
- Verifier: `tests/accuracy.test.ts`.

#### [CD-13] Condition-list course data

- Parent: [EP-01]
- Lane: Course Data
- Owner: Unassigned
- Priority: normal
- Summary: Define the course JSON shape, loader validation, shared domain type, and any storage change for condition lists.
- Done when: Course data accepts valid condition lists, rejects invalid list shapes, and exposes one shared condition-list type for downstream lanes.
- Verifier: `tests/course-loader.test.ts`.

#### [BR-13] Condition-list bot flow

- Parent: [EP-01]
- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Apply condition-list course data during bot lobby setup and run flow.
- Done when: Bot runtime loads condition lists for course attempts and announces results without assuming a single condition.
- Verifier: `tests/bot.test.ts`.

#### [WC-12] Condition-list catalog rendering

- Parent: [EP-01]
- Lane: Web Catalog
- Owner: Unassigned
- Priority: normal
- Summary: Render multiple pass conditions per map and course on the dan catalog routes.
- Done when: Catalog pages show condition lists clearly without changing route semantics.
- Verifier: `tests/web-routes.test.ts`.

#### [DP-26] Condition-list ship-time docs

- Parent: [EP-01]
- Lane: Docs
- Owner: Unassigned
- Priority: normal
- Summary: Update public docs when condition lists ship.
- Done when: README, product contract, roadmap, Kanban, and any course-authoring notes describe shipped condition-list behavior without ahead-of-scope claims.
- Verifier: Manual docs audit against README, `docs/product-contract.md`, `docs/roadmap.md`, and this board after [JD-11], [CD-13], [BR-13], and [WC-12] are Released.

#### [BR-10] Ready command to skip rest

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Let the target player send `!ready` between maps to skip the remaining countdown.
- Done when: Only the target player can skip rest during waiting states, and tests cover ignored senders/states.
- Verifier: TBD.

#### [JD-12] Mode-specific judgment counters

- Lane: Judgment
- Owner: Unassigned
- Priority: low
- Summary: Add taiko, mania, catch/ctb, and lazer osu!standard judgment counters behind the normalized score-stats layer from [JD-10].
- Done when: Judgment code reads those counters through normalized stats and never assumes raw fields exist on stable multiplayer scores.
- Verifier: TBD.

#### [BR-11] Bot runtime reliability backlog

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Superseded by [BR-14], [BR-15], [BR-16], and [BR-17].
- Done when: Child reliability items are tracked as single-deliverable Bot Runtime cards.
- Verifier: This board.

#### [BR-14] Surface abort reasons

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Emit distinct abort reasons for known run-abort paths.
- Done when: Each abort path reports a stable reason that can be logged, tested, and explained to the player where useful.
- Verifier: `tests/bot.test.ts`.

#### [BR-15] Score-resolution diagnostics

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Make score-fetch fallback and error paths diagnosable without reading live IRC logs.
- Done when: Missing score, delayed score, and API timeout cases produce distinct log fields and player-safe messages.
- Verifier: `tests/bot.test.ts`.

#### [BR-16] Restart-safe manual checks

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Document or automate the live Bancho restart checks for bot recovery.
- Done when: A contributor can run a restart/reconnect check with `pnpm bot:dev <system-name> <course-name>` and verify cleanup plus restart behavior.
- Verifier: Documented live Bancho procedure, or an automated equivalent if the flow becomes mockable.

#### [BR-17] Command and help consistency

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: Keep command parsing, abbreviated inputs, unknown commands, and help output consistent.
- Done when: Help text and command responses describe the same supported command surface.
- Verifier: `tests/bot.test.ts`.

#### [DP-10] Staff proof review policy

- Lane: Docs
- Owner: Unassigned
- Priority: low
- Summary: Decide whether replay-file or handcam review belongs in the product.
- Done when: The policy states whether proof review is in scope and how it affects recorded outcomes.
- Verifier: TBD.

#### [BR-12] Lazer/API v2 room-control research

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: low
- Summary: Research authentication, room control, score payloads, and live update feasibility before implementation.
- Done when: A short research note identifies viable APIs, blockers, and whether stable IRC remains the baseline.
- Verifier: TBD.

#### [WC-10] Dynamic profile banner generation

- Lane: Web Catalog
- Owner: Unassigned
- Priority: low
- Summary: Explore generated pass banners only after hosting, verification URL, abuse handling, and proof semantics are clear.
- Done when: The product decision separates cosmetic summaries from official proof.
- Verifier: TBD.

#### [WC-11] Custom course creation UI

- Lane: Web Catalog
- Owner: Unassigned
- Priority: low
- Summary: Add a write UI only after auth, ownership, moderation, validation, and persistence decisions are explicit.
- Done when: The design defines who can create courses and how invalid or abusive content is handled.
- Verifier: TBD.

#### [JD-20] Add a focused helper test

- Lane: Judgment
- Owner: Unassigned
- Priority: low
- Summary: Cover an uncovered branch in `src/lib/accuracy.ts` or `src/lib/mods.ts`.
- Done when: A focused test lands under `tests/` without changing behavior.
- Verifier: TBD.

#### [CD-20] Add a course JSON example

- Lane: Course Data
- Owner: Unassigned
- Priority: low
- Summary: Add one small course entry following `docs/course-authoring.md` plus a loader validation test.
- Done when: The example is valid, documented authoring steps still apply, and the loader test covers a name-key collision or validation failure.
- Verifier: `tests/course-loader.test.ts`.

#### [WC-20] Polish the dan catalog empty state

- Lane: Web Catalog
- Owner: Unassigned
- Priority: low
- Summary: Improve the no-systems or no-courses copy without changing routes or data shape.
- Done when: The empty state is clearer and route behavior remains unchanged.
- Verifier: TBD.

## Next

No cards.

## In Progress

No cards.

## Review

No cards.

## Released

#### [BR-01] Start flow

- Lane: Bot Runtime
- Owner: N/A
- Priority: high
- Summary: A player can DM `!dojo start <system-name> <course-name>` and receive a multiplayer lobby invite.
- Done when: The bot creates an `osu!dojo:` room and invites the requesting player.
- Verifier: `tests/bot.test.ts`.

#### [BR-02] Name-key validation

- Lane: Bot Runtime
- Owner: N/A
- Priority: high
- Summary: Unknown or invalid public name keys return an error instead of creating a lobby.
- Done when: Invalid system/course keys fail before room creation.
- Verifier: `tests/bot.test.ts`.

#### [BR-03] Course sequencing

- Lane: Bot Runtime
- Owner: N/A
- Priority: high
- Summary: The bot loads course beatmaps in ordinal order and advances after each completed map.
- Done when: A seeded multi-map course runs from first map to final result.
- Verifier: `tests/bot.test.ts`.

#### [BR-04] Inactivity abort

- Lane: Bot Runtime
- Owner: N/A
- Priority: normal
- Summary: Inactive runs abort with a restart path instead of hanging forever.
- Done when: Stalled pre-join and in-progress runs clean up and allow a fresh start.
- Verifier: `tests/bot.test.ts`.

#### [BR-05] Lobby cleanup

- Lane: Bot Runtime
- Owner: N/A
- Priority: normal
- Summary: Rooms close after completion, abort, or bot shutdown.
- Done when: Cleanup does not block forever and active-run shutdown closes the lobby.
- Verifier: `tests/bot.test.ts`.

#### [JD-01] Per-map pass judgment

- Lane: Judgment
- Owner: N/A
- Priority: high
- Summary: Per-map results compare accuracy or score against the map threshold.
- Done when: Accuracy and score thresholds select the correct score field.
- Verifier: `tests/accuracy.test.ts`.

#### [JD-02] Overall pass judgment

- Lane: Judgment
- Owner: N/A
- Priority: high
- Summary: A course passes only when all maps pass and the course-level threshold passes.
- Done when: Overall accuracy and score paths both pass and fail correctly.
- Verifier: `tests/accuracy.test.ts`.

#### [JD-03] Stable osu!standard scoring scope

- Lane: Judgment
- Owner: N/A
- Priority: high
- Summary: Current judgment targets stable osu!standard multiplayer scores and force-adds NF.
- Done when: Accuracy uses stable hit counts and bot setup preserves the required NoFail behavior.
- Verifier: `tests/accuracy.test.ts`, `tests/bot.test.ts`.

#### [JD-04] Result announcements

- Lane: Judgment
- Owner: N/A
- Priority: normal
- Summary: The bot announces per-map and final course outcomes in lobby chat.
- Done when: Completed and failed course runs emit result messages.
- Verifier: `tests/bot.test.ts`.

#### [CD-01] Name-key derivation

- Lane: Course Data
- Owner: N/A
- Priority: high
- Summary: Public system/course keys derive from display names by trimming, lowercasing, and replacing whitespace with hyphens.
- Done when: Commands and routes use display-name keys instead of internal slugs.
- Verifier: `tests/course-loader.test.ts`, `tests/web-routes.test.ts`.

#### [CD-02] Name-key collision hard-fail

- Lane: Course Data
- Owner: N/A
- Priority: high
- Summary: Course loading rejects duplicate system or course name keys.
- Done when: Duplicate display-name keys fail at load time.
- Verifier: `tests/course-loader.test.ts`.

#### [CD-03] JSON course authoring surface

- Lane: Course Data
- Owner: N/A
- Priority: normal
- Summary: Seed course data comes from JSON files under `data/courses/`.
- Done when: The loader reads seeded JSON and rejects unsupported shapes.
- Verifier: `tests/course-loader.test.ts`, `tests/db-and-pages.test.ts`.

#### [WC-01] Home system overview

- Lane: Web Catalog
- Owner: N/A
- Priority: high
- Summary: `/` lists dan systems and their courses.
- Done when: The home route renders seeded system data.
- Verifier: `tests/db-and-pages.test.ts`, `tests/web-routes.test.ts`.

#### [WC-02] Dan catalog

- Lane: Web Catalog
- Owner: N/A
- Priority: high
- Summary: `/dan` lists dan systems in catalog form.
- Done when: The catalog route renders seeded systems and links to detail routes.
- Verifier: `tests/db-and-pages.test.ts`, `tests/web-routes.test.ts`.

#### [WC-03] Dan system detail route

- Lane: Web Catalog
- Owner: N/A
- Priority: high
- Summary: `/dan/[systemNameKey]?course=<courseNameKey>` renders all courses and supports selected-course anchors.
- Done when: The detail route renders course data, beatmaps, pass conditions, and leaderboard state.
- Verifier: `tests/web-routes.test.ts`.

#### [WC-04] Read-only SSR catalog

- Lane: Web Catalog
- Owner: N/A
- Priority: normal
- Summary: The site is read-only, unauthenticated, and server-rendered.
- Done when: Public catalog pages render without auth or write actions.
- Verifier: `src/app/`, `tests/web-routes.test.ts`.

#### [DP-01] Product contract source

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: `docs/product-contract.md` describes current shipped behavior and scope.
- Done when: README and roadmap point to the product contract for current scope.
- Verifier: `README.md`, `docs/roadmap.md`, `docs/product-contract.md`.

#### [DP-02] Kanban source

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: `docs/kanban.md` is the single source for epic status.
- Done when: Public docs point to Kanban instead of the retired change queue.
- Verifier: `README.md`, `docs/onboarding.md`, `docs/contributing.md`, `docs/roadmap.md`.

#### [DP-03] Contributor-safe docs prep

- Lane: Docs
- Owner: N/A
- Priority: normal
- Summary: Contributor setup, PR entry rules, roadmap, and current-scope docs are available without private planning references.
- Done when: Public docs avoid private/tooling references and expose setup plus first-task paths.
- Verifier: `docs/onboarding.md`, `docs/contributing.md`, `docs/roadmap.md`.

#### [DP-20] Attach verifier links to Released cards

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: Audit every Released card against source, tests, or manual verification.
- Done when: Every Released card has a concrete verifier, and any unverified claim moves out of Released.
- Verifier: Manual audit of this file against `tests/bot.test.ts`, `tests/accuracy.test.ts`, `tests/course-loader.test.ts`, `tests/db-and-pages.test.ts`, `tests/web-routes.test.ts`, README, `docs/product-contract.md`, `docs/roadmap.md`, and `src/app/`.

#### [CD-11] Course authoring guide and validation checklist

- Lane: Course Data
- Owner: N/A
- Priority: high
- Summary: Document how to add real course JSON safely.
- Done when: Required fields, name-key rules, smoke checks, and validation failures are documented.
- Verifier: `docs/course-authoring.md`, `src/db/courseLoader.ts`, `tests/course-loader.test.ts`.

#### [DP-25] Define fuller team operating rules

- Lane: Docs
- Owner: N/A
- Priority: normal
- Summary: Expand conventions with branch naming, PR size, review expectations, and handoff rules.
- Done when: `docs/conventions.md` covers the full team workflow without duplicating the product contract.
- Verifier: `docs/conventions.md`.

#### [DP-30] Tracked public-doc coherence

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: Keep the public contributor reading path limited to tracked docs with no stale private-planning references.
- Done when: README, onboarding, contributing, Kanban, product contract, roadmap, and conventions link only to current public docs.
- Verifier: Stale-reference scan across the public doc set returns no retired queue, retired MVP spec, local plans directory, local team plan, or advanced automation research-title references.

## Not Planned

#### [WC-90] Pacemaker overlays and real-time leaderboard surfaces

- Lane: Web Catalog
- Owner: None
- Priority: low
- Summary: Do not pursue live telemetry overlays or generic real-time leaderboard surfaces.
- Done when: The direction remains excluded from active lanes and endorsed roadmap phases.
- Verifier: `docs/roadmap.md`.
