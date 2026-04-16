# 온보딩

깨끗한 clone에서 로컬 실행까지 가는 절차입니다. live credential은 로컬에만 둡니다.

## 요구사항

- Node.js 20+
- pnpm 10.6+
- live bot을 실행하려면 osu! legacy API key와 IRC credential

## 로컬 실행

1. 의존성 설치

   ```bash
   pnpm install
   ```

2. `.env` 생성

   ```bash
   cp .env.example .env
   ```

3. credential 입력

   ```env
   OSU_IRC_USERNAME=
   OSU_IRC_PASSWORD=
   OSU_API_KEY=
   DATABASE_URL=file:./dojo.db
   ```

   `.env`, `dojo.db`, log, live credential은 커밋하지 않습니다.

4. 자동 검증

   ```bash
   pnpm test
   pnpm build
   ```

5. 웹사이트 실행

   ```bash
   pnpm dev
   ```

6. 브라우저 확인

   - `http://localhost:3000/`
   - `http://localhost:3000/dan`
   - `http://localhost:3000/dan/test?course=1st`

## 봇 확인

`pnpm bot`은 live IRC bot process를 실행합니다. 실제 osu! IRC/API credential이 필요합니다.

`pnpm bot:dev test 1st`는 본인 계정으로 Bancho에 연결해서 `!dojo start test 1st`를 주입하는 live dev trigger입니다. 오프라인 테스트가 아니며, 성공하면 terminal에 multiplayer room link가 출력됩니다.

## 주요 위치

- 웹사이트: `src/app/`
- 봇 process: `src/bot/index.ts`
- 봇 factory와 test seam: `src/bot/runtime.ts`
- 코스 데이터: `data/courses/`
- 코스 작성 가이드: `docs/course-authoring.md`
- 도메인과 판정 로직: `src/lib/`

## 첫 작업 고르기

처음에는 `docs/kanban.md`의 낮은 우선순위 Backlog 카드부터 보는 편이 좋습니다. 작업을 시작하기 전에 owner와 verifier shape이 명확한지 확인합니다.

코스 JSON을 만지는 작업이면 `docs/course-authoring.md`를 먼저 읽습니다. PR은 한 가지 일만 담고, handoff 전에 `pnpm build && pnpm test` 결과와 필요한 manual check를 적습니다.
