# osu!dojo

[English](#english) | [한국어](#한국어)

---

## English

**osu!dojo** is a dan (course) progression platform for osu! that automates skill verification via IRC bot.

### Features

- **IRC Bot** manages multiplayer lobbies for dan attempts
- **Two-tier clear system**: Normal Pass and Gold Pass with separate requirements
- **Pacemaker overlay**: Real-time score comparison using tosu (MY-BEST / RIVAL)
- **Multi-map courses**: Single or multi-map dans with various requirement options
- **Leaderboards**: Per-dan rankings with score normalization

### Quick Start

Prerequisites: Node.js (LTS), Docker

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Start infrastructure + app
npm run docker:up
npm run db:generate
npm run db:migrate
npm run dev

# Start bot (separate terminal)
npm run bot
```

### Environment Variables

See `.env.example` for all options. Key variables:

| Variable                                | Description                                                                |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                          | PostgreSQL connection string                                               |
| `REDIS_URL`                             | Redis connection string                                                    |
| `OSU_IRC_USERNAME` / `OSU_IRC_PASSWORD` | IRC credentials from [osu.ppy.sh/p/irc](https://osu.ppy.sh/p/irc)          |
| `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET`   | OAuth app from [osu! settings](https://osu.ppy.sh/home/account/edit#oauth) |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL`      | NextAuth session config                                                    |

### Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full system documentation including:

- Core flows (attempt lifecycle, pacemaker, recovery)
- Data model
- Delegation-ready task plan

### URLs (Local Dev)

- **Web app**: http://localhost:3000
- **Overlay**: http://localhost:3000/overlay/{attemptId}?ip=localhost
- **Leaderboard**: http://localhost:3000/dans/{danId}/leaderboard
- **Prisma Studio**: `npm run db:studio`

### IRC Commands

```
!dojo           # Show help
!dojo list      # List available dans
!dojo start <id> # Start dan attempt
```

---

## 한국어

**osu!dojo**는 IRC 봇을 통해 단(코스) 클리어를 자동으로 검증하는 osu! 실력 progression 플랫폼입니다.

### 주요 기능

- **IRC 봇**이 멀티플레이어 로비를 관리하여 단 시도 진행
- **2단계 클리어 시스템**: Normal Pass / Gold Pass 별도 요구조건
- **페이스메이커 오버레이**: tosu를 사용한 실시간 점수 비교 (MY-BEST / RIVAL)
- **멀티맵 코스**: 단일 또는 여러 맵 단, 다양한 요구조건 옵션
- **리더보드**: 단별 랭킹

### 빠른 시작

필수: Node.js (LTS), Docker

```bash
npm install

cp .env.example .env
# .env 파일에 자격증명 입력

npm run docker:up
npm run db:generate
npm run db:migrate
npm run dev

# 봇 실행 (별도 터미널)
npm run bot
```

### 환경변수

`.env.example` 참조. 주요 변수:

- `DATABASE_URL`, `REDIS_URL`
- `OSU_IRC_USERNAME`, `OSU_IRC_PASSWORD` (IRC 비밀번호: [osu.ppy.sh/p/irc](https://osu.ppy.sh/p/irc))
- `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET` (OAuth: [osu! 설정](https://osu.ppy.sh/home/account/edit#oauth))
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

### 아키텍처

전체 시스템 문서: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

### 오버레이

tosu WebSocket(`ws://<ip>:24050/ws`)에 연결됩니다.

- 기본: `http://localhost:3000/overlay/<attemptId>?ip=localhost`
- OBS 소스:
  - Bars only: `?view=bars`
  - Delta only: `?view=delta`

### 스크립트

```bash
npm run dev          # Next.js 개발 서버
npm run bot          # IRC 봇
npm run db:studio    # Prisma Studio
npm run docker:up    # Docker 컨테이너 시작
npm test             # 테스트 실행
```

---

_Last updated: December 2025_
