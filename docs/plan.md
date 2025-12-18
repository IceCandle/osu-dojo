# osu!dojo 개발 로드맵

업데이트: 2025-12-18

---

## 현재 상태 (한 줄 요약)

봇의 핵심 플로우: 시도(Attempt) 생성/큐 → 멀티 로비 → 맵 진행 → 점수 저장 → 성공/실패 처리.

## 이미 구현된 것 (코드 기준)

- queue consumer + attempt 처리: `src/bot/index.ts`
- DM commands(`!dojo start/list`): `src/bot/commands.ts`
- (legacy) ban/candidate 런타임 플로우: 제거됨(정적 코스 셔플로 대체)
- 멀티 진행 + 매 맵 점수 DB 저장 + 합격/금합격 판정: `src/bot/multiplayer.ts`
- 로비 상태 Redis 저장 + heartbeat + 좀비 로비 탐지: `src/bot/recovery.ts`
- 구조화 로깅: `src/lib/logger.ts`
- 관리자 attempt 점검/재시작 API: `src/app/api/admin/attempts/[id]/route.ts`
- osu! API v2 wrapper(레이트리밋/토큰 관리): `src/lib/osu-api.ts`
- OAuth 로그인(NextAuth + Prisma): `src/app/api/auth/[...nextauth]/route.ts`

## 오버레이(부분 구현, 사용 가능)

- 3바 페이스메이커 오버레이: `src/app/overlay/[attemptId]/page.tsx`
- 라이벌/지코베 API: `src/app/api/attempts/[id]/rival/route.ts`, `src/app/api/attempts/[id]/my-best/route.ts`
- 오버레이 라이브 스탯(슬밋 등) 저장 → 봇이 읽어 DB 반영: `src/app/api/attempts/[id]/live-stats/route.ts`, `src/bot/multiplayer.ts`

## 확정 정책

- 시작 후 유저가 일시정지/재개 불가 (크래시 복구/관리자 재시작만 가능)

---

## DB/스키마: 이미 들어간 항목

`prisma/schema.prisma` 및 마이그레이션에 이미 포함됨:

- 2단계 클리어: `Beatmap.requiredScore`, `Beatmap.goldClearScore`, `Attempt.isNormalPass`, `Attempt.isGoldPass`
- 멀티 게임모드 기반: `GameMode`, `ScoringSystem`, `Dan.gameMode`, `Beatmap.gameMode`
- 슬밋 트래킹 필드: `AttemptScore.sliderbreaks`, `AttemptScore.effectiveMisses`
- 매니아 섹션 시스템: `BeatmapSection`, `SectionScore` (+ `Beatmap.hasSections`)
- DanSystem(시스템/티어 구조): `DanSystem` (+ `Dan.danSystemId`, `Dan.tierInSystem`)
- (legacy) 후보맵/밴 시스템 필드: 제거됨(마이그레이션 적용 완료)

---

## 로드맵

### 봇 안정화 & 코어 인프라

상태: **DONE(핵심 루프)**

- [DONE] 큐 처리/시도 프로세서
- [DONE] (legacy) 밴-우선 후보맵 선택 (피벗에서 제거됨)
- [DONE] 로비 상태 저장/하트비트/좀비 탐지
- [DONE] 매 맵 점수 DB 저장 + 노멀/골드 판정
- [DONE] 슬라이더브레이크(오버레이 기반) 저장
- [DONE] 관리자 점검/재시작
- [DONE] 크래시 후 매치 히스토리 리컨실(점수 백필) 완성: `src/bot/recovery.ts` ✅
- [DONE] Redis Pub/Sub 이벤트 발행 (7개 lifecycle 지점) ✅
- [DONE] 플레이어 연결 끊김 처리 (자동 attempt 종료) ✅
- [DONE] 헬스체크 엔드포인트: `src/app/api/health/route.ts` ✅
- [TODO] 데이터베이스 시드 스크립트 follow real-life examples: `prisma/seed.ts` ✅

남은 것

- [TODO] 봇 모듈 `console.log` → `createLogger` 정리(선택)

### OAuth + osu! API v2

상태: **IN PROGRESS**

- [DONE] NextAuth osu! 로그인 + 토큰 저장
- [DONE] osu! API v2 래퍼
- [TODO] 친구(Friend) 모델/동기화 + 친구 하이라이트

### 스킬셋 태그 & 리더보드

상태: **PLANNED**

### 페이스메이커 오버레이

상태: **IN PROGRESS(베이스 존재)**

- [DONE] 오버레이 + (마이베스트/라이벌) 시계열 점수
- [TODO] friends/same-dan/rotate target
- [DONE] OBS multi-source 모드(view=full/bars/delta) + 설정 localStorage 저장
- [DONE] 오버레이 상단 배너 클릭 → public pass score statistics 페이지로 이동(+ attempt historyLink)
- [DONE] 리플레이 업로드 API + timestamp/MD5/score 검증(src/app/api/replays/upload, src/lib/replay-validation.ts) ✅

### 정적 코스 피벗 (Static Course System)

상태: **IN PROGRESS(설계/부분 구현)**

- [DONE] public attempt stats 페이지(유저명 포함) + overlay에서 Stats 링크
- [DONE] OBS multi-source(view 파라미터) + overlay 설정 localStorage
- [DONE] 시도 제한: 유저+자격증(= danSystemId+tierInSystem) 기준 rolling 24h 카운트(3회/24h, 봇 `!dojo start` 단계에서 차단)
- [DONE] 후보맵/밴 로직 제거 + 정적 코스 셔플 적용
- [DONE] 셔플 규칙: 일반 코스는 전체 셔플 / 보스 지정 코스는 마지막 맵 고정(관례)

### 커스텀 단(MD5/팩)

상태: **PLANNED**

- [PARTIAL] 공식 맵 `.osu` 캐시 기반 MD5 계산 헬퍼: `src/lib/replay-parser.ts` (`getBeatmapMD5`)

---

## Quick Links (Where To Look First)

- 봇 시작점: `src/bot/index.ts`
- 시도 진행/점수 저장: `src/bot/multiplayer.ts`
- 복구/좀비 처리: `src/bot/recovery.ts`
- 스키마: `prisma/schema.prisma`
- 오버레이: `src/app/overlay/[attemptId]/page.tsx`

## Common Commands

```bash
npm run dev
npm run bot
npm run docker:up
npm run db:migrate
```

---

## 진행 관리(추천)

긴 문서 대신 **이슈/보드로 진행을 추적**하는 걸 권장합니다.

기본 추천: **GitHub Issues + GitHub Projects(보드)**

- Phase(1~6) = Epic(또는 Milestone)
- 구현 단위(엔드포인트/마이그레이션/봇 플로우 1개) = Issue
- 라벨 예시: `phase:1`, `bot`, `overlay`, `db`, `api`, `recovery`, `prio:p0`
- 보드 컬럼 예시: `Backlog` → `Ready` → `In Progress` → `Review` → `Done`
- 각 Issue의 DoD는 “어떤 파일/라우트가 바뀌고, 어떻게 확인하는지(명령어/시나리오)” 2~3줄로만 적기

대안(팀 선호에 따라): Linear(이슈 중심) / Notion(문서+태스크 혼합)
