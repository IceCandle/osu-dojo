# Contributing

Use pull requests for project changes. Keep one scoped task per PR. Include the Kanban card ID when the PR implements carded work, and include the commands or manual checks you ran.

## Rules

- Working rules live in `docs/conventions.md`.
- Current work lives in `docs/kanban.md`.
- PRs that implement a sub-card should reference both the sub-card ID and its parent `[EP-xx]` in the PR description.
- Run `pnpm build && pnpm test` before handoff unless the PR notes explain why a check could not run.
- Never commit `.env`, `dojo.db`, logs, API keys, IRC passwords, or other credentials.

## First Tasks

Start from low-priority Backlog cards in `docs/kanban.md`, or ask for one card to be moved into Next with an owner and verifier. For course-data work, read `docs/course-authoring.md` before editing `data/courses/*.json`.
