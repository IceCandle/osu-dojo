# Contributor Onboarding

Use this path for a clean clone. It keeps live credentials local and gets you to a small first task without changing product scope.

## Requirements

- Node.js 20+
- pnpm 10.6+
- osu! legacy API key and IRC credentials if you need to run the live bot

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create `.env` from `.env.example`:

   ```bash
   cp .env.example .env
   ```

3. Fill in local credentials:

   ```env
   OSU_IRC_USERNAME=
   OSU_IRC_PASSWORD=
   OSU_API_KEY=
   DATABASE_URL=file:./dojo.db
   ```

   Never commit `.env`, `dojo.db`, logs, or live credentials.

4. Run the automated checks:

   ```bash
   pnpm test
   pnpm build
   ```

5. Start the website:

   ```bash
   pnpm dev
   ```

   Visit `http://localhost:3000/`, `http://localhost:3000/dan`, and `http://localhost:3000/dan/test?course=1st`.

## Bot Checks

`pnpm bot` runs the live IRC bot process. It requires real osu! IRC/API credentials.

`pnpm bot:dev test 1st` is an optional live Bancho dev trigger for your own account. It is not an offline test. It connects to Bancho, injects `!dojo start test 1st`, and prints the multiplayer room link in the terminal.

## Entry Points

- Website: `src/app/`
- Bot process: `src/bot/index.ts`
- Bot factory and test seam: `src/bot/runtime.ts`
- Course data: `data/courses/`
- Course authoring guide: `docs/course-authoring.md`
- Domain and judging logic: `src/lib/`

## First Task

Pick a low-priority Backlog card in `docs/kanban.md`, or ask for one card to be moved into Next with an owner and verifier. If the task touches course JSON, follow `docs/course-authoring.md`. Keep the PR scoped to that task, run `pnpm build && pnpm test`, and include the exact commands you ran in the PR notes.
