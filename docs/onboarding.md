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

5. Check routes.

   - `http://localhost:3000/`
   - `http://localhost:3000/dan`
   - `http://localhost:3000/dan/test?course=1st`

## 봇 확인

`pnpm bot`은 live IRC bot process를 실행합니다.

`pnpm bot:dev test 1st`는 본인 계정으로 Bancho에 연결해서 `!dojo start test 1st`를 주입하는 live dev trigger입니다. 오프라인 테스트가 아니며, 성공하면 터미널에 멀티방 링크가 출력됩니다.

## 주요 위치

- 웹사이트: `src/app/`
- 봇 process: `src/bot/index.ts`
- 봇 factory와 test seam: `src/bot/runtime.ts`
- 코스 데이터: `data/courses/`
- 코스 작성 가이드: `docs/course-authoring.md`
- 도메인과 판정 로직: `src/lib/`

## Next Docs

Contributor entry path는 `README.md`, PR 규칙은 `docs/conventions.md`.
