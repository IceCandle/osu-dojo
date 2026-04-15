# Conventions

Use this page for working rules. Product scope lives in `docs/product-contract.md`; epic status lives in `docs/kanban.md`.

## Lanes

- Bot Runtime: `src/bot/`, multiplayer lifecycle, score ingestion, timeouts, and live-check scripts.
- Judgment: `src/lib/accuracy.ts`, `src/lib/judging.ts`, scoring rules, pass/fail behavior, and score formatting.
- Course Data: `data/courses/`, `src/db/courseLoader.ts`, seed behavior, and validation.
- Web Catalog: `src/app/`, route rendering, catalog pages, leaderboard presentation, and browser smoke checks.
- Docs: README, product contract, Kanban, onboarding, conventions, and roadmap.

## Testing

Changes to `src/lib/` or `src/bot/runtime.ts` should start with a failing test, then make it pass. UI copy and styling changes do not need test-first work, but route behavior changes need a route or render check.

Run `pnpm build && pnpm test` before handoff.

## Epics and Sub-cards

When a feature touches more than one lane, create an `[EP-xx]` parent card plus one sub-card per affected lane.

Parent epic cards use Lane `Cross-lane`, an Owner, a Summary of the integrated outcome, a Child cards list, a `Done when` condition requiring all children to be Released plus an epic verifier, and a Verifier with one integrated automated proof path. Parent epics start with Owner `Unassigned` in Backlog; assign a coordinator before moving one to Next.

Sub-cards add `Parent: [EP-xx]`. Sub-cards own their lane outcome and may touch shared-boundary files only when the parent epic names the shared boundary and the PR calls out the cross-lane impact.

Shared-boundary changes such as `src/lib/domain.ts` or `src/db/schema.ts` are coordinated on the epic card. Parent epics do not duplicate child acceptance criteria, and specialists own sub-cards rather than epics.

Verifiers prefer automated proof first. Live Bancho checks with `pnpm bot:dev <system-name> <course-name>` are credential-gated and optional.

Changes to `docs/product-contract.md` only happen when a feature actually ships, through a dedicated docs sub-card.

## Branches

Use `lane/card-id-short-summary` for carded work, such as `bot/br-14-abort-reasons`, `course-data/cd-20-course-example`, or `docs/dp-30-public-docs`. Tiny uncarded fixes may use `docs/typo-readme` or another short descriptive name.

## Claiming Cards

Claim a card by setting its Owner in `docs/kanban.md`. Move a Backlog card to In Progress in the same PR only when the verifier shape is clear. If a card is not ready, update the card with the missing verifier or ask for it to be moved to Next before starting implementation.

## PR Size

Keep one card per PR. Split a PR when it changes more than one lane, needs more than one verifier path, or mixes behavior changes with documentation cleanup. Cross-lane epic children may share a branch only when the parent epic explicitly names the shared boundary and the PR keeps each child outcome separate in the description.

Tiny uncarded PRs are limited to typo fixes, broken-link fixes, formatting-only cleanup, or comments that do not change behavior.

## Review Expectations

Prefer a reviewer familiar with the affected lane. One approval is enough for narrow docs, tests, and single-lane code changes. Ask for an additional reviewer when a PR touches shared boundaries, live bot behavior, schema/domain types, or product-contract wording.

Reviewers should check spec compliance, verifier strength, and scope control before style. New product ideas go to the Kanban Backlog instead of expanding the active PR.

## Handoff

Before moving a card to Review, run `pnpm build && pnpm test` or explain the blocker in the PR notes. Include any manual route check or live Bancho check with exact commands and outcomes.

Move a card to Released only after the verifier is green on the current branch, the PR is merged, and the Kanban movement is included in that same PR or a follow-up docs-only PR. Review to Released means the claim is true in the repository, not just locally.

## Good First PRs

A good first PR picks a Backlog card with a concrete verifier, keeps to one lane, and starts with the smallest proof of behavior. For `src/lib/` or `src/bot/runtime.ts`, write the failing test first. For course-data changes, follow `docs/course-authoring.md`. For docs-only changes, verify the reading path and links by inspection.

Every first PR should mention the card ID, list `pnpm build && pnpm test` results, and call out any manual check that was skipped because it needs credentials.

## Shared Boundaries

Ask before changing `src/db/schema.ts` or `src/lib/domain.ts`; those files affect multiple lanes. If a task needs a schema or domain change, call out the impacted lanes in the PR notes.

Do not add dependencies without explaining why the current stack cannot cover the task.

## Ready and Done

A Backlog card is ready for Next when it has an owner, one-line goal, affected lane, and expected verifier shape.

A parent epic is ready for Next when every child card meets the existing ready criteria, every child has an owner, the parent has a coordinator owner, and the parent has an epic verifier shape.

A task is done when its `Done when` condition is true, `pnpm build && pnpm test` pass, unrelated files are untouched, and any manual route or live Bancho checks are documented.

## PRs

Keep one scoped task per PR. Include the commands you ran, any manual checks, and the Kanban card ID when the PR implements carded work. Never commit `.env`, `dojo.db`, logs, API keys, IRC passwords, or other credentials.

Tiny changes do not need a Kanban card when they are limited to typo fixes, broken-link fixes, formatting-only cleanup, or comments that do not change behavior. The PR still names what was changed and runs the smallest relevant check.

Important boundary: the exemption should not apply to anything that changes product behavior, routes, bot runtime, schema/domain types, course data semantics, or judgment logic. Those should stay carded and verified.
