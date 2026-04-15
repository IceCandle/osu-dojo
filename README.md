# osudojo

`osudojo` is an automated osu! dan course platform. A Bancho IRC bot manages multiplayer rooms for course runs, and a Next.js site shows the seeded course catalog and run results.

## Project Notes

- The multiplayer bot and website live in the same Next.js workspace.
- The current judgment flow targets `osu!standard` stable multiplayer scores.
- Current scope is captured in [`docs/product-contract.md`](docs/product-contract.md).
- Current and deferred work is tracked in [`docs/kanban.md`](docs/kanban.md).
- New contributor setup starts in [`docs/onboarding.md`](docs/onboarding.md); small PR rules live in [`docs/contributing.md`](docs/contributing.md), with working conventions in [`docs/conventions.md`](docs/conventions.md).
- Course JSON authoring rules live in [`docs/course-authoring.md`](docs/course-authoring.md).
- Longer-term direction is aspirational and lives in [`docs/roadmap.md`](docs/roadmap.md).

## Public Routes

- `/` — home and system overview
- `/dan` — dan catalog
- `/dan/[systemNameKey]?course=<courseNameKey>` — system detail with an optional selected course anchor

## Local Setup

1. Install Node.js 20+ and `pnpm`.
2. Install dependencies with `pnpm install`.
3. Copy `.env.example` to `.env` and fill in your osu! IRC and legacy API credentials.
4. Run `pnpm test` and `pnpm build`.
5. Start the website with `pnpm dev`.
6. Run the live bot process with `pnpm bot`.

The SQLite database is created and seeded locally from `data/courses/*.json` plus demo result data on first boot. Local runtime artifacts such as `.env`, `dojo.db`, and dev logs are intentionally not committed.

## Commands

- `pnpm dev`
- `pnpm bot`
- `pnpm bot:dev test 1st` (live Bancho dev trigger; requires real credentials)
- `pnpm build`
- `pnpm test`
