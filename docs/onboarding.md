# 온보딩

깨끗한 clone에서 로컬 실행까지 가는 절차입니다.

## Requirements

- Node.js 20+
- pnpm 10.6+
- osu! legacy API key와 IRC credential for live bot checks

## Local Run

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Create `.env`.

   ```bash
   cp .env.example .env
   ```

3. Fill env values.

   ```env
   OSU_IRC_USERNAME=
   OSU_IRC_PASSWORD=
   OSU_API_KEY=
   DATABASE_URL=file:./dojo.db
   ```

4. Run checks and site.

   ```bash
   pnpm test
   pnpm build
   pnpm dev
   ```

   If you pulled the system-lifecycle schema change over an older local checkout,
   delete `dojo.db` first and let `pnpm dev` reseed it.

5. Check routes.

   - `http://localhost:3000/`
   - `http://localhost:3000/dan`
   - `http://localhost:3000/dan/test?course=1st`

## 봇 확인

`pnpm bot`은 live IRC bot process를 실행합니다.

`pnpm bot:dev test 1st`는 본인 계정으로 Bancho에 연결해서 `!dojo start test 1st`를 주입한 뒤 `!dojo` 명령을 직접 입력할 수 있는 REPL을 엽니다. `pnpm bot:dev`처럼 인자 없이 실행하면 시작 명령 주입 없이 REPL만 엽니다. 오프라인 테스트가 아니며, 방이 생성되면 터미널에 멀티방 링크가 출력됩니다.

## 주요 위치

- 웹사이트: `src/app/`
- 봇 process: `src/bot/index.ts`
- 봇 factory와 test seam: `src/bot/runtime.ts`
- 코스 데이터: `data/courses/`
- 코스 작성 가이드: `docs/course-authoring.md`
- 도메인과 판정 로직: `src/lib/`

## Next Docs

Contributor entry path는 `README.md`, PR 규칙은 `docs/conventions.md`.
