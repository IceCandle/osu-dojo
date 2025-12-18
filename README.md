# osu!dojo

osu!dojo는 **단(코스) 기반 실력 progression** 플랫폼을 목표로 하는 프로젝트입니다.

- 봇(IRC/멀티 로비)이 Attempt를 진행하고
- 서버가 점수/상태를 DB에 저장하며
- 오버레이가 tosu 데이터를 이용해 라이브 정보를 보조적으로 전달합니다.

## 빠른 시작

필수:

- Node.js (권장: 최신 LTS)
- Postgres + Redis (로컬 설치 또는 Docker)

```bash
npm install

cp .env.example .env

npm run docker:up
npm run db:generate
npm run db:migrate

npm run dev
```

봇 실행(별도 터미널):

```bash
npm run bot
```

## 환경변수(.env)

`.env.example`를 그대로 복사해서 시작하세요. 주요 키:

- `DATABASE_URL`
- `REDIS_URL`
- `OSU_IRC_USERNAME`, `OSU_IRC_PASSWORD` (봇)
- `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`, `OSU_REDIRECT_URI` (osu! OAuth)
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

## 주요 엔트리/폴더

- 봇 시작점: `src/bot/index.ts`
- DM 커맨드: `src/bot/commands.ts`
- 멀티 진행/점수 저장: `src/bot/multiplayer.ts`
- 복구/좀비 처리: `src/bot/recovery.ts`
- Prisma 스키마: `prisma/schema.prisma`
- 오버레이: `src/app/overlay/[attemptId]/page.tsx`

## 오버레이 참고

오버레이는 기본적으로 tosu WebSocket(`ws://<ip>:24050/ws`)에 붙습니다.

- 예: `http://localhost:3000/overlay/<attemptId>?ip=localhost`
- OBS multi-source 예:
  - Bars only: `http://localhost:3000/overlay/<attemptId>?ip=localhost&view=bars`
  - Delta only: `http://localhost:3000/overlay/<attemptId>?ip=localhost&view=delta`

Public 페이지:

- Attempt stats: `http://localhost:3000/attempts/<attemptId>/stats`
- Course leaderboard: `http://localhost:3000/dans/<danId>/leaderboard`

## 스크립트

`package.json`의 주요 스크립트:

- `npm run dev` / `npm run build` / `npm run start`
- `npm run bot`
- `npm run db:migrate` / `npm run db:studio` / `npm run db:seed`
- `npm run docker:up` / `npm run docker:down`
