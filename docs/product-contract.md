# Product Contract: osu!dojo

이 문서는 현재 shipped behavior를 적는 product contract입니다. 미래 목표나 아이디어가 아니라, 지금 제품이 지켜야 하는 동작만 다룹니다.

## Goal

osu! dan course를 자동 multiplayer room에서 진행하는 IRC bot, pass/fail 판정, 결과 저장, 그리고 course와 최근 결과를 보여주는 최소 웹사이트를 제공합니다.

## Architecture

- **Runtime:** Node.js 20+
- **Framework:** Next.js 14+ App Router
- **Bot process:** `src/bot/`의 별도 long-running Node process. osu! IRC/multiplayer는 `bancho.js` 사용
- **Database:** SQLite + Drizzle ORM. 현재 scope에서는 single file, zero ops
- **Structure:** 하나의 Next.js project 안에 bot을 별도 entry point(`pnpm bot`)로 둠
- **Credentials:** `.env`에 osu! IRC username, IRC password, legacy API key 저장

## Domain Model

```text
DanSystem (id, name, slug, description)
  has many Dan (id, name, courseSlug, danSystemId, ordinal, scoreModel: "scorev1"|"scorev2")
    has many DanBeatmap (id, danId, beatmapId, mods, passCondition: {type: "acc"|"score", threshold: number}, ordinal)

Result (id, userId, danId, passed, timestamp, matchId?)
  has many MapResult (id, resultId, gameId?, beatmapId, score, accuracy, passed)
```

- Dan은 course입니다. N개의 map을 순서대로 플레이하고, 각 map은 자기 pass condition을 가집니다.
- DanSystem은 `test`, `tr1ple`처럼 관련된 dan을 묶습니다.
- `slug`와 `courseSlug`는 internal seed/database identifier입니다. public command와 URL은 display-name key를 사용합니다.

## Public Name Keys

- player는 internal slug가 아니라 display-name key로 system과 course를 지정합니다.
- name key는 display name을 trim하고, lowercase로 바꾸고, whitespace run을 `-`로 바꿔 만듭니다.
- system/course display name은 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 합니다.
- 두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 course loading은 hard-fail합니다.
- old slug-based command와 URL은 fallback으로 지원하지 않습니다.

## Public Routes

- `/` — home과 system overview
- `/dan` — dan catalog
- `/dan/[systemNameKey]?course=<courseNameKey>` — dan system detail page. 모든 course를 순서대로 렌더링하고, optional selected-course anchor를 지원

## Acceptance Criteria

### AC1: Bot Start Flow

- player가 bot IRC account에 DM으로 `!dojo start <system-name> <course-name>`를 보냅니다. 두 argument는 display-name key입니다.
- bot은 `osu!dojo: <dan_name>` 제목의 multiplayer room을 만듭니다.
- bot은 player를 초대하고, player가 room에 join합니다.
- system 또는 course name key가 invalid/unknown이면 bot은 error message를 보냅니다.

### AC2: Course Sequencing

- bot은 DB에서 dan definition을 load합니다.
- 첫 beatmap과 올바른 mods를 설정합니다.
- 각 map이 끝나면 rest time 이후 다음 map으로 자동 진행합니다. 기본 rest time은 20s입니다.
- 마지막 map 이후 course가 complete됩니다.

### AC3: Result Ingestion

- 각 map이 끝난 뒤 bot은 match result에서 player score를 수집합니다.
- `{userId, danId, beatmapId, score, accuracy, passed, timestamp}`를 저장합니다.

### AC4: Pass/Fail Judgment

- per-map 판정은 DanBeatmap의 threshold와 accuracy 또는 score를 비교합니다.
- overall 판정은 모든 map이 passed이고, course-level score/accuracy criteria도 통과해야 passed입니다.
- bot은 multiplayer chat에 per-map result와 final result를 알립니다.

### AC5: Website

- `/`는 dan system과 course를 보여줍니다.
- `/dan`은 dan system을 catalog 형태로 보여줍니다.
- `/dan/[systemNameKey]`는 해당 system의 모든 course, beatmap list, pass condition, integrated leaderboard, `?course=<courseNameKey>` anchor jump를 렌더링합니다.
- auth는 없습니다. read-only입니다. SSR with server components입니다.

## Demo Scenario

1. sample dan system `test`와 dan `1st`, beatmap 2개를 seed합니다.
2. bot process 실행: `pnpm bot`
3. player가 bot에 DM 전송: `!dojo start test 1st`
4. bot이 room을 만들고, player를 초대하고, 첫 map을 설정합니다.
5. player가 map 1을 플레이합니다. bot이 score를 읽고 pass/fail을 판단한 뒤 `Map 1: PASS (97.2% >= 95%)`를 알립니다.
6. bot이 map 2를 설정합니다. 같은 흐름을 반복합니다.
7. map 2 이후 bot이 `1st: PASS` 또는 `fail (1,050,000 vs 1,240,000)`를 알립니다.
8. result가 DB에 저장됩니다.
9. `http://localhost:3000/dan/test?course=1st`에서 course와 latest result를 확인합니다.

## Deferred Direction

deferred work는 `docs/kanban.md`에서 추적합니다. aspirational direction은 `docs/roadmap.md`에 요약합니다.

pacemaker overlay와 real-time leaderboard는 현재 product direction이 아닙니다. osu!dojo의 near-term value는 자동 forced-start lobby flow입니다. tosu 또는 osu!collector-style surface를 다시 만드는 것이 목표가 아닙니다.
