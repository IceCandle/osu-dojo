# 동작 기준: osu!dojo

이 문서는 현재 구현된 동작을 명시하는 동작 기준 문서입니다. 미래 목표나 아이디어가 아니라, 지금 지켜야 하는 동작만 다룹니다.

## Goal

osu! dan course를 자동 멀티플레이어 방에서 진행하는 IRC bot, pass/fail 판정, 결과 저장, 그리고 course와 최근 결과를 보여주는 최소 웹사이트를 제공합니다.

## Architecture

- **Runtime:** Node.js 20+
- **Framework:** Next.js 14+ App Router
- **Bot process:** `src/bot/`의 별도 상시 구동 Node process. osu! IRC/멀티플레이어는 `bancho.js` 사용
- **Database:** SQLite + Drizzle ORM. 현재 범위에서는 단일 파일, 별도 운영 불필요
- **Credentials:** `.env`에 osu! IRC username, IRC password, legacy API key 저장

## Domain Model

```text
DanSystem (id, name, slug, description, status: "draft"|"current"|"legacy"|"archived")
  has many Course (
    id,
    name,
    slug,
    danSystemId,
    ordinal,
    scoreModel: "scorev1"|"scorev2"
  )
    has many Beatmap (id, courseId, beatmapId, mods, passCondition: {type: "acc"|"score", threshold: number}, ordinal)

BeatmapMetadata (beatmapId, title, artist, difficultyName, mapper, coverUrl, totalObjects)

CourseRun (id, userId, courseId, passed, timestamp, matchId?)
  has many MapResult (id, runId, gameId?, beatmapId, score, accuracy, passed)
```

상태는 `DanSystem`에만 있습니다. Course는 system의 상태를 상속합니다.

| 상태 | `/dan` 목록 | exact key URL / bot | gameplay 수정 | run 저장 |
| --- | --- | --- | --- | --- |
| `current` | 공개 | 가능 | 불가 | 저장 |
| `legacy` | current 아래에 공개 | 가능 | 불가 | 저장 |
| `draft` | 비공개 | 가능 | 가능 | 저장 안 함 |
| `archived` | 비공개 | 불가 | 불가 | 저장 안 함 |

`current`와 `legacy`는 기능적으로 같습니다. 둘 다 플레이 가능하고 결과를 저장하며 gameplay field는 frozen입니다. 차이는 catalog 정렬과 badge뿐입니다. `draft`는 exact key로 접근할 수 있지만 단 리스트에는 공개하지 않고, 플레이 결과도 저장하지 않습니다.

## Public Name Key

- 플레이어는 내부 `slug`가 아니라 display-name key로 system과 course를 지정합니다.
- key는 display name을 trim하고, 소문자로 바꾸고, 연속 공백을 `-`로 바꿔 만듭니다.
- system/course display name은 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 합니다.
- 두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 course loading은 즉시 실패합니다.
- 이전 slug 기반 명령어와 URL은 대체 경로로 지원하지 않습니다.

## Public Routes

- `/` — home과 system 개요
- `/dan` — current와 legacy system catalog
- `/dan/[systemNameKey]?course=<courseNameKey>` — playable system 상세 페이지. draft는 exact key로만 접근됩니다.

## Acceptance Criteria

### AC1: Bot Start Flow

- 플레이어가 bot IRC 계정에 DM으로 `!dojo start <system-name> <course-name>`를 보냅니다. 두 인자는 보이는 namekey입니다.
- `!dojo start`는 `draft`, `current`, `legacy` system을 exact key로 resolve합니다.
- `archived` 또는 알 수 없는 key는 오류 메시지를 보냅니다.
- `draft` system의 run은 저장하지 않습니다. `current`와 `legacy` system의 run은 저장합니다.
- 플레이어는 `!dojo help`로 사용법을 확인할 수 있습니다.
- 같은 bot process 안에서 이전에 성공적으로 확인된 시작 명령은 `!dojo prev`로 다시 실행할 수 있습니다.
- 플레이어는 멀티플레이어 로비 채팅(`#mp_<id>`)에서 `!dojo skip`을 입력해 첫 map 또는 map 사이의 남은 시작 대기 시간을 건너뜁니다. DM의 `!dojo skip`은 동작하지 않습니다.
- 플레이어가 이미 진행 중인 run이 있는 상태에서 `!dojo start`를 다시 보내면, bot은 이전 방을 닫고 새 방을 만듭니다. resolved map이 있으면 이전 run은 DNF로 저장됩니다.
- 플레이어가 로비에서 나가면 현재 run이 중단됩니다.
- bot은 `osu!dojo: <system_name> / <course_name>` 제목의 멀티플레이어 방을 만듭니다.

### AC2: Course Sequencing

- bot은 DB에서 course 정의를 불러옵니다.
- 첫 beatmap과 올바른 mods를 설정합니다.
- 각 map이 끝나면 휴식 시간 이후 다음 map으로 자동 진행합니다. 기본 휴식 시간은 20초입니다.
- 마지막 map 이후 course가 완료됩니다.

### AC3: Result Ingestion

- 각 map이 끝난 뒤 bot은 match result에서 플레이어 점수를 수집합니다.
- 저장 대상 run이면 `{userId, courseId, beatmapId, score, accuracy, passed, timestamp}`를 저장합니다.

### AC4: Pass/Fail Judgment

- 개별 map 판정은 course beatmap의 threshold와 accuracy 또는 score를 비교합니다.
- 전체 판정은 모든 map이 passed이고, course 단위 score/accuracy 기준도 통과해야 passed입니다.
- course 단위 `acc` 기준은 통과한 map accuracy의 합계와 threshold를 비교합니다. 실패했거나 플레이하지 않은 map은 Course Acc에 더하지 않습니다.
- course 단위 `score` 기준은 플레이한 map score의 합계와 threshold를 비교합니다.
- bot은 멀티플레이어 채팅에 개별 map 결과와 최종 결과를 알립니다.

### AC5: Website

- `/`와 `/dan`은 current와 legacy system을 보여줍니다.
- legacy system은 badge를 표시하고 current 아래에 정렬됩니다.
- `/dan/[systemNameKey]`는 playable system의 모든 course, beatmap 목록, 통과 조건, 통합 리더보드, `?course=<courseNameKey>` 앵커 이동을 렌더링합니다.
- draft detail page는 Draft badge를 표시하고, draft run은 저장되지 않는다고 안내합니다.
- 리더보드의 `Course Acc`는 통과한 map accuracy의 합계입니다.
- 인증(auth)은 없습니다. 읽기 전용입니다. SSR with server components입니다.
