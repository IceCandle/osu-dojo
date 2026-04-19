# 동작 기준: osu!dojo

이 문서는 현재 구현된 동작을 명시하는 동작 기준 문서입니다. 미래 목표나 아이디어가 아니라, 현재 지켜야 하는 동작만 다룹니다.
예정 작업은 GitHub Issues에서 추적합니다.

## Goal

osu! dan course를 자동 멀티플레이어 방에서 진행하는 IRC bot, pass/fail 판정, 결과 저장, 그리고 course와 최근 결과를 보여주는 최소 웹사이트를 제공합니다.

## Architecture

- **Runtime:** Node.js 20+
- **Framework:** Next.js 14+ App Router
- **Bot process:** `src/bot/`의 별도 상시 구동 Node process. osu! IRC/멀티플레이어는 `bancho.js` 사용
- **Database:** SQLite + Drizzle ORM. 현재 범위에서는 단일 파일, 별도 운영 불필요(zero ops)
- **Structure:** 하나의 Next.js project 안에 bot을 별도 진입점(`pnpm bot`)으로 둠
- **Credentials:** `.env`에 osu! IRC username, IRC password, legacy API key 저장

## Domain Model

```text
DanSystem (id, name, slug, description)
  has many Course (id, name, slug, danSystemId, ordinal, scoreModel: "scorev1"|"scorev2")
    has many Beatmap (id, courseId, beatmapId, mods, passCondition: {type: "acc"|"score", threshold: number}, ordinal)

CourseRun (id, userId, courseId, passed, timestamp, matchId?)
  has many MapResult (id, runId, gameId?, beatmapId, score, accuracy, passed)
```

- DanSystem은 `test`, `tr1ple`처럼 관련된 course를 묶는 최상위 framework입니다.
- Course는 DanSystem 안의 플레이 가능한 단위입니다. N개의 beatmap을 순서대로 플레이하고, 각 beatmap은 자체 통과 조건(pass condition)을 가집니다.
- `slug`는 system과 course 각각의 내부 seed/database 식별자입니다. 공개 명령어와 URL은 display-name key를 사용합니다.

## Public Name Keys

- 플레이어는 내부 slug가 아니라 display-name key로 system과 course를 지정합니다.
- name key는 display name을 trim하고, 소문자로 바꾸고, 연속 공백을 `-`로 바꿔 만듭니다.
- system/course display name은 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 합니다.
- 두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 course loading은 즉시 실패(hard-fail)합니다.
- 이전 slug 기반 명령어와 URL은 대체 경로(fallback)로 지원하지 않습니다.

## Public Routes

- `/` — home과 system 개요
- `/dan` — dan 카탈로그
- `/dan/[systemNameKey]?course=<courseNameKey>` — dan system 상세 페이지. 모든 course를 순서대로 렌더링하고, 선택된 course 앵커를 지원

## Acceptance Criteria

### AC1: Bot Start Flow

- 플레이어가 bot IRC 계정에 DM으로 `!dojo start <system-name> <course-name>`를 보냅니다. 두 인자는 display-name key입니다.
- 플레이어는 `!dojo help`로 간단한 사용법을 확인할 수 있고, 같은 bot process 안에서 이전에 성공적으로 확인된 시작 명령은 `!dojo prev`로 다시 실행할 수 있습니다.
- 플레이어는 멀티플레이어 로비 채팅(`#mp_<id>`)에서 `!dojo skip`을 입력해 첫 map 또는 map 사이의 남은 시작 대기 시간을 건너뜁니다. DM의 `!dojo skip`은 동작하지 않습니다.
- 플레이어가 이미 진행 중인 run이 있는 상태에서 `!dojo start`를 다시 보내면, bot은 이전 방을 닫고 새 방을 만듭니다. resolved map이 있으면 이전 run은 DNF로 저장됩니다.
- 플레이어가 로비에서 나가면(ESC) `playerLeft`로 현재 run이 중단됩니다.
- bot은 `!dojo`로 시작하지만 알려진 명령이 아닌 DM에 사용법 안내를 보냅니다.
- bot은 `osu!dojo: <system_name> / <course_name>` 제목의 멀티플레이어 방을 만듭니다.
- bot은 플레이어를 초대하고, 플레이어가 방에 참가합니다.
- system 또는 course name key가 잘못되었거나 알 수 없으면 bot은 오류 메시지를 보냅니다.

### AC2: Course Sequencing

- bot은 DB에서 course 정의를 불러옵니다.
- 첫 beatmap과 올바른 mods를 설정합니다.
- 각 map이 끝나면 휴식 시간 이후 다음 map으로 자동 진행합니다. 기본 휴식 시간은 20초입니다.
- 마지막 map 이후 course가 완료됩니다.

### AC3: Result Ingestion

- 각 map이 끝난 뒤 bot은 match result에서 플레이어 점수를 수집합니다.
- `{userId, courseId, beatmapId, score, accuracy, passed, timestamp}`를 저장합니다.

### AC4: Pass/Fail Judgment

- 개별 map 판정은 course beatmap의 threshold와 accuracy 또는 score를 비교합니다.
- 전체 판정은 모든 map이 passed이고, course 단위 score/accuracy 기준도 통과해야 passed입니다.
- course 단위 `acc` 기준은 통과한 map accuracy의 합계와 threshold를 비교합니다. 실패했거나 플레이하지 않은 map은 Course Acc에 더하지 않습니다.
- course 단위 `score` 기준은 플레이한 map score의 합계와 threshold를 비교합니다.
- bot은 멀티플레이어 채팅에 개별 map 결과와 최종 결과를 알립니다.

### AC5: Website

- `/`는 dan system과 course를 보여줍니다.
- `/dan`은 dan system을 카탈로그 형태로 보여줍니다.
- `/dan/[systemNameKey]`는 해당 system의 모든 course, beatmap 목록, 통과 조건(pass condition), 통합 리더보드, `?course=<courseNameKey>` 앵커 이동을 렌더링합니다.
- 리더보드의 `Course Acc`는 통과한 map accuracy의 합계입니다.
- 인증(auth)은 없습니다. 읽기 전용입니다. SSR with server components입니다.

## Demo Scenario

1. 샘플 dan system `test`와 course `1st`, beatmap 2개를 seed합니다.
2. bot process 실행: `pnpm bot`
3. 플레이어가 bot에 DM 전송: `!dojo start test 1st`
4. bot이 방을 만들고, 플레이어를 초대하고, 첫 map을 설정합니다.
5. 플레이어가 map 1을 플레이합니다. bot이 점수를 읽고 pass/fail을 판단한 뒤 `Map 1: PASS (97.2% >= 95%)`를 알립니다.
6. bot이 map 2를 설정합니다. 같은 흐름을 반복합니다.
7. map 2 이후 bot이 `1st: PASS` 또는 `fail (1,050,000 vs 1,240,000)`를 알립니다.
8. 결과가 DB에 저장됩니다.
9. `http://localhost:3000/dan/test?course=1st`에서 course와 최근 결과를 확인합니다.
