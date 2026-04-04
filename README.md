# osudojo

`osudojo` is an automated osu! dan course MVP. A Bancho IRC bot manages multiplayer rooms for course runs, and a Next.js site shows the seeded course catalog and run results.

## MVP Notes

- The multiplayer bot and website live in the same Next.js workspace.
- The current judgment flow targets `osu!standard` stable multiplayer scores.
- MVP scope is frozen in [`docs/mvp-spec.md`](docs/mvp-spec.md); deferred ideas live in [`docs/change-queue.md`](docs/change-queue.md).

## Local Setup

1. Install Node.js 20+ and `pnpm`.
2. Install dependencies with `pnpm install`.
3. Copy `.env.example` to `.env` and fill in your osu! IRC and legacy API credentials.
4. Start the website with `pnpm dev`.
5. Run the bot process with `pnpm bot`.

The SQLite database is created and seeded locally from `data/courses/*.json` plus demo result data on first boot. Local runtime artifacts such as `.env`, `dojo.db`, and dev logs are intentionally not committed.

## Commands

- `pnpm dev`
- `pnpm bot`
- `pnpm build`
- `pnpm test`
