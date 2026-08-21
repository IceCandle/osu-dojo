# 동작 기준: osu!dojo

이 문서는 현재 구현된 동작을 명시하는 동작 기준 문서입니다. 미래 목표나 아이디어가 아니라, 지금 지켜야 하는 동작만 다룹니다.

## Goal

osu! dan course를 자동 멀티플레이어 방에서 진행하는 IRC bot, pass/fail 판정, 결과 저장, 그리고 course/최근 결과/검색/플레이어 프로필을 보여주는 최소 웹사이트를 제공합니다.

## Architecture

- **Runtime:** Node.js 20+
- **Framework:** Next.js 14+ App Router
- **Bot process:** `src/bot/`의 별도 상시 구동 Node process. osu! IRC/멀티플레이어는 `bancho.js` 사용
- **Database:** SQLite + Drizzle ORM. 현재 범위에서는 단일 파일, 별도 운영 불필요
- **Credentials:** `.env`에 osu! IRC username/password와 OAuth client ID/secret 저장. 공개 bot 데이터는 client credentials token으로 osu! API v2에서 조회

## Domain Model

```text
DanSystem (id, name, slug, description, status: "draft"|"current"|"legacy"|"archived", ladder?, ladderOrder)
  has many Course (
    id,
    name,
    slug,
    danSystemId,
    ordinal,
    official,
    label?,
    scoreModel: "scorev1"|"scorev2",
    overallPassConditions: Array<{type: "courseAccuracy"|"totalScore"|"totalMissCount", threshold: number}>
  )
    has many Beatmap (
      id,
      courseId,
      beatmapId,
      mods,
      freemod,
      passConditions: Array<{type: "accuracy"|"score"|"missCount"|"maxCombo", threshold: number}>,
      ordinal
    )

BeatmapMetadata (beatmapId, title, artist, difficultyName, mapper, coverUrl, totalObjects)

HomepageFeaturedCourse (courseId, position)

CourseRun (id, userId, courseId, passed, timestamp, matchId?)
  has many MapResult (id, runId, gameId?, beatmapId, score, rawScore, playedMods, accuracy, passed)
```

상태는 `DanSystem`에만 있습니다. Course는 system의 상태를 상속합니다. Course의 `official`은 상태가 아니라 관리자가 고르는 표시용 인정 여부입니다.

| 상태 | `/dan` 목록 | exact key URL / bot | gameplay 수정 | run 저장 |
| --- | --- | --- | --- | --- |
| `current` | 공개 | 가능 | 불가 | 저장 |
| `legacy` | current 아래에 공개 | 가능 | 불가 | 저장 |
| `draft` | 비공개 | 가능 | 가능 | 저장 안 함 |
| `archived` | 비공개 | 불가 | 불가 | 저장 안 함 |

`current`와 `legacy`는 기능적으로 같습니다. 둘 다 플레이 가능하고 결과를 저장하며 gameplay field는 frozen입니다. 차이는 catalog 정렬과 badge뿐입니다. `draft`는 exact key로 접근할 수 있지만 단 리스트에는 공개하지 않고, 플레이 결과도 저장하지 않습니다.

`official`, `label`, `ladder`, `ladderOrder`는 표시용 메타데이터입니다. gameplay 판정, 명령어 key, Public Name Key 규칙에는 쓰지 않습니다. 같은 `ladder`를 가진 여러 시스템은 player 프로필에서 하나의 진행도로 합쳐 보이며, 더 큰 `ladderOrder`가 더 높은 단계입니다.

`HomepageFeaturedCourse.position`은 운영자가 메인에 공개할 course 순서를 기록하는 큐레이션 메타데이터입니다. 최근 통과 기록의 표시 순서를 정하는 값은 아닙니다.

## Public Name Key

- 플레이어는 내부 `slug`가 아니라 display-name key로 system과 course를 지정합니다.
- key는 display name을 trim하고, 소문자로 바꾸고, 연속 공백을 `-`로 바꿔 만듭니다.
- system/course display name은 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 합니다.
- 두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 course loading은 즉시 실패합니다.
- 이전 slug 기반 명령어와 URL은 대체 경로로 지원하지 않습니다.

## Public Routes

- `/` — home과 system 개요
- `/dan` — current와 legacy system catalog
- `/api/search?q=` — 전역 헤더 검색 dialog가 조회하는 읽기 전용 JSON endpoint
- `/dan/[systemNameKey]?course=<courseNameKey>` — playable system 상세 페이지. draft는 exact key로만 접근됩니다.
- `/players/[userId]` — 로컬 `users` 정보를 기준으로 만든 읽기 전용 페이지. 숫자가 아닌 `userId`나 `users` 행이 없는 ID는 404이고, `users` 행은 있지만 run이 없으면 각 영역의 빈 상태를 보여줍니다.
- `/settings` — 로그인 사용자가 프로필 상세 공개 여부를 바꾸는 설정 페이지
- `GET /api/auth/osu/login` — osu! OAuth 로그인을 시작하고 authorization 화면으로 이동
- `GET /api/auth/osu/callback` — osu! OAuth 응답을 확인하고 로컬 session을 생성
- `POST /api/auth/logout` — 현재 server session을 폐기하고 session cookie를 제거
- `POST /api/settings/pinned` — 로그인 사용자의 course 대표 클리어를 지정·교체·해제
- `POST /api/settings/visibility` — 로그인 사용자의 프로필 상세 공개 여부를 저장

## Acceptance Criteria

### AC1: Bot Start Flow

- 플레이어가 bot IRC 계정에 DM으로 `!dojo start <system-name> <course-name>`를 보냅니다. 두 인자는 보이는 namekey입니다.
- `!dojo start`는 `draft`, `current`, `legacy` system을 exact key로 resolve합니다.
- `archived` 또는 알 수 없는 key는 오류 메시지를 보냅니다.
- `draft` system의 run은 저장하지 않습니다. `current`와 `legacy` system의 run은 저장합니다.
- 플레이어는 `!dojo help`로 사용법을 확인할 수 있습니다.
- 같은 bot process 안에서 이전에 성공적으로 확인된 시작 명령은 `!dojo prev`로 다시 실행할 수 있습니다.
- 플레이어는 멀티플레이어 로비에서 osu! 기본 Ready 버튼을 눌러 첫 map 또는 map 사이의 남은 시작 대기 시간을 건너뜁니다.
- 플레이어가 이미 진행 중인 run이 있는 상태에서 `!dojo start`를 다시 보내면, bot은 이전 방을 닫고 새 방을 만듭니다. resolved map이 있으면 이전 run은 DNF로 저장됩니다.
- 플레이어가 로비에서 나가면 현재 run이 중단됩니다.
- 위와 같이 중단되었거나, 진행 중이던 run이 프로세스 재시작, Bancho 연결 끊김, 매치 중단, score 미발견, score API 지연 등으로 끊기면 bot은 그 run을 이어서 복구하지 않습니다. 가능한 경우 남은 로비를 정리하고, 플레이어는 `!dojo start`로 새 run을 시작합니다. 런타임이 중단을 처리해 run을 저장한 경우에는 저장된 map 결과를 기준으로 pass/fail/DNF가 계산되며, 저장할 run 상태나 map 결과가 없으면 run 결과를 저장하지 않습니다.
- bot은 `(osu!dojo): (<player_name>) vs (<system_name> <course_name>)` 제목의 멀티플레이어 방을 만듭니다.

### AC2: Course Sequencing

- bot은 DB에서 course 정의를 불러옵니다.
- 첫 beatmap과 올바른 mods를 설정합니다.
- 첫 map 시작 전 기본 대기 시간은 120초입니다.
- Beatmap의 `freemod`가 true이면 해당 map에만 Bancho FreeMod를 켭니다. 플레이어 선택은 `NM`, `HD`, `HR`, `HDHR`만 허용하고, `NF`는 score 제출 안정성을 위한 선택 사항으로 안내합니다.
- 각 map 시작 전 bot은 멀티플레이어 채팅에 해당 map의 통과 조건을 안내합니다. 비교 표현은 `accuracy >= 95.00%`, `miss <= 5`, `max combo >= 300`처럼 표시합니다.
- ScoreV2의 `score`와 `totalScore` threshold는 adjusted(NM-equivalent) 기준으로 작성합니다. Bot은 Bancho raw ScoreV2를 플레이한 mod multiplier(`MOD_MULTIPLIERS_SV2`)로 나눈 adjusted score로 판정합니다. Leaderboard도 adjusted `score` 합계 기준으로 정렬하고 `Adjusted Score Total`로 표시합니다.
- ScoreV2 고정 mod map의 score target은 player가 osu!에서 보는 값과 비교할 수 있도록 `raw score >= Y`로 표시합니다. FreeMod map의 pre-map score target은 `adjusted score >= X`로 표시하고, `Raw score by choice`가 허용된 mod 조합별 raw 값을 나열합니다.
- 마지막 ScoreV2 map에서 bot은 map-level `score` threshold와 course-level `totalScore` remaining을 하나의 effective adjusted target으로 합칩니다. effective 값은 `max(map score threshold, totalScore remaining, 0)`입니다. 고정 mod이면 `Targets:` 안에 `raw score >= N`을 합쳐 표시합니다. FreeMod이면 `Targets:` 안에 `adjusted score >= N`을 표시하고, target이 있을 때만 `Raw score by choice: ...` support line을 추가합니다. map `score` 조건이 있으면 그 위치를 유지하고, 없으면 마지막 segment로 추가합니다. 이미 `Course cannot pass:`를 표시한 run에서는 이후 final-map `totalScore` remaining을 pre-map target에 다시 합치지 않습니다.
- 각 completed full map 뒤에는 `Course targets:`를 한 줄 표시합니다. Segment는 course condition 순서대로 `courseAccuracy X / Y`, `adjusted total score X / Y` 또는 `total score X / Y`, `totalMissCount X / Y` 형식입니다. Partial play는 해당 map에서 이 줄을 즉시 표시하지 않지만, partial 결과의 score와 miss는 이후 진행도 totals에 포함됩니다.
- 각 map이 끝나면 pass/fail과 관계없이 휴식 시간 이후 다음 map으로 자동 진행합니다. 기본 휴식 시간은 30초입니다.
- run이 더 이상 course를 통과할 수 없음이 확인되면 bot은 `Course cannot pass:` 안내를 한 번만 표시하고 남은 map을 계속 진행합니다. 확인 대상은 `map N threshold failed`, `totalMissCount threshold exceeded`, `courseAccuracy threshold unreachable`입니다. `totalScore`는 증명된 상한 규칙이 없어 위 트리거 목록에서 제외합니다.
- Human-facing map announcement에서는 score 제출 안정성을 위해 강제로 넣는 `NF`를 숨깁니다. 실제 lobby 설정에는 계속 `!mp mods`로 `NF`를 포함해 보냅니다.
- 마지막 map 이후 course가 완료됩니다.

### AC3: Result Ingestion

- 각 map이 끝난 뒤 bot은 match result에서 플레이어 점수를 수집합니다.
- 저장 대상 run이면 `{userId, courseId, beatmapId, score, rawScore, playedMods, accuracy, passed, timestamp}`를 저장합니다. ScoreV2에서 `score`는 adjusted 판정 점수이고, `rawScore`는 Bancho API raw score입니다. `rawScore`는 audit과 lobby의 raw 목표 안내에만 씁니다.
- Beatmap object count가 있는 map에서 제출 score의 hit object 합계가 총 object 수보다 작으면 partial play로 실패 처리합니다. API 제출 직후의 작은 집계 race를 흡수하기 위해 `delta <= 2` 또는 `played / total >= 0.99`인 경우 한 번 지연 후 재조회합니다.
- FreeMod map에서 제출 score에 `NF`가 없으면 bot은 HP가 0이 된 뒤의 score 제출 안정성을 위해 다음부터 `NF`를 추가하라는 안내를 표시합니다. 이 안내만으로 play를 실패 처리하지 않습니다.

### AC4: Pass/Fail Judgment

- 개별 map 판정은 course beatmap의 `passConditions` 목록을 AND로 평가합니다.
- map 조건 type은 `accuracy`, `score`, `missCount`, `maxCombo`입니다. `accuracy`, `score`, `maxCombo`는 실제 값이 threshold 이상이어야 하고, `missCount`는 threshold 이하여야 합니다. `score` 조건은 `scoreModel: "scorev2"` course에서만 허용되며, ScoreV2 `score` threshold는 adjusted 기준입니다.
- 전체 판정은 모든 map이 passed이고, course 단위 `overallPassConditions` 목록도 모두 통과해야 passed입니다.
- course 조건 type은 `courseAccuracy`, `totalScore`, `totalMissCount`입니다. `courseAccuracy`와 `totalScore`는 실제 값이 threshold 이상이어야 하고, `totalMissCount`는 threshold 이하여야 합니다. `totalScore` 조건은 `scoreModel: "scorev2"` course에서만 허용됩니다.
- course 단위 `courseAccuracy` 기준은 통과한 map accuracy의 합계와 threshold를 비교합니다. 실패했거나 플레이하지 않은 map은 Course Acc에 더하지 않습니다.
- course 단위 `totalScore` 기준은 플레이한 map의 adjusted `score` 합계와 threshold를 비교합니다.
- 같은 condition list 안에서 같은 type은 한 번만 쓸 수 있고, course loading은 중복 type을 즉시 실패시킵니다.
- bot은 멀티플레이어 채팅에 개별 map 결과와 최종 결과를 알립니다. 진행 중 course 통과가 불가능해진 첫 시점에는 이를 한 번 알리고, 최종 map까지 진행한 뒤 최종 결과를 알립니다. `totalScore`는 증명된 상한 규칙이 없어 위 트리거 목록에서 제외합니다.

### AC5: Website

- `/`와 `/dan`은 current와 legacy system을 보여줍니다.
- `/`는 최근 30일 안에 통과한 featured official course를 최대 3개 보여줍니다. 같은 사용자와 course의 통과는 가장 최근 것 하나만 남기고, `completedAt DESC, runId DESC` 순서로 표시합니다. mode는 `osu!standard`로 고정하며 결과가 없으면 조용한 빈 상태를 보여줍니다.
- legacy system은 badge를 표시하고 current 아래에 정렬됩니다.
- `/dan/[systemNameKey]`는 playable system의 모든 course, beatmap 목록, 통과 조건, 통합 리더보드, `?course=<courseNameKey>` anchor 이동을 렌더링합니다.
- 로그인 사용자의 course 최고 기록에는 전체 순위를 함께 표시합니다. 내 기록이 상위 10개 안이면 해당 leaderboard 행을 강조하고, 10위 밖이면 기존 상위 10개 아래에 내 기록을 한 번 더 표시합니다. 익명 사용자와 다른 사용자의 leaderboard 표시 규칙은 바뀌지 않습니다.
- draft detail page는 상응하는 정보를 표시하고, draft run은 저장되지 않는다고 안내합니다.
- 리더보드의 `Course Acc`는 통과한 map accuracy의 합계입니다.
- `users`는 OAuth 로그인 또는 run 저장으로 로컬에서 확인한 사용자의 현재 이름과 프로필 존재 여부의 기준입니다. 기존 run 사용자 중 `users` 행이 없는 사용자는 DB 이전에서 채웁니다. OAuth callback과 run 저장은 더 오래된 확인 시각이 현재 username을 되돌리지 않도록 확인 시각이 같거나 더 새로운 경우에만 `users.username`을 갱신합니다.
- `/players/[userId]`는 `users` 행이 있으면 정상 프로필을 표시하고 username은 항상 `users.username`을 사용합니다. 대표 클리어·최근 run·많이 플레이한 course section은 제목 바로 옆에 항목 수를 표시하며 데이터가 없어도 `0`으로 남겨 두고 별도 빈 상태 문구는 표시하지 않습니다. 최고 official dan section은 항목 수 없이 상세 공개 설정과 관계없이 항상 표시하고, 나머지 세 section은 상세가 공개되는 viewer에게만 표시합니다. `users` 행이 없거나 `userId`가 숫자가 아니면 로컬 기록이 없다는 404를 표시합니다. osu! API 조회, profile cache, account linking은 없습니다. avatar는 `https://a.ppy.sh/{userId}`를 사용합니다.
- Player profile은 최고 official dan badge, 대표 클리어 최대 5개, 최근 run, 많이 플레이한
  course, play count를 보여줍니다. 최고 official dan은 통과한 official course만 대상으로
  하며, 같은 ladder 안에서는 `(ladderOrder, course ordinal)`이 가장 큰 course 하나만
  badge로 보여줍니다. badge 글자는 `course.label`이 있으면 그것을 쓰고, 없으면 course
  name을 씁니다.
- 대표 클리어는 각 course 상세 페이지에서 로그인 사용자의 해당 course 최고 pass run을
  지정하거나 교체·해제합니다. 사용자와 course 조합마다 하나만 저장하고, 사용자당 서로
  다른 course는 최대 5개입니다. 프로필에서는 최근 지정 시각인 `pinned_at DESC`로
  표시합니다. 자동 선택과 수동 순서 변경은 없으며 `/settings`에는 대표 클리어 run
  선택 화면을 두지 않습니다. 대표 클리어에는 course/system, score 또는 accuracy, 완료
  시간을 표시하고 leaderboard rank는 표시하지 않습니다.
- `profile_details_public`은 기본 true입니다. false여도 프로필 경로, username, avatar,
  최고 official dan, player 검색, course leaderboard의 run과 순위는 계속 공개됩니다.
  다른 사용자에게는 play count, 최근 run, 많이 플레이한 course, run의 score/accuracy/시간,
  대표 클리어만 숨깁니다. 소유자는 자신의 상세를 항상 볼 수 있고, 다시 공개하면 저장된
  상세 기록과 대표 클리어가 다시 표시됩니다.
- Player profile의 mode selector는 표시용 scaffold입니다. 현재 동작은 osu!standard만 지원합니다.
- 전역 헤더 검색 버튼은 client component dialog를 열고, 읽기 전용 `/api/search?q=` JSON endpoint로 current/legacy 시스템과 코스를 display name 기준으로 찾습니다. 유저 검색은 현재 `users.username`과 과거 `runs.username`을 모두 검색 별칭으로 사용하고, 같은 osu! user ID는 한 번만 현재 `users.username`으로 표시합니다. run이 없는 `users` 사용자도 검색할 수 있습니다. `/api/search`는 osu! API나 외부 network를 호출하지 않습니다. system 결과는 `/dan/<systemNameKey>`, course 결과는 `/dan/<systemNameKey>?course=<courseNameKey>`, player 결과는 `/players/<userId>`로 이동합니다. system/course route key는 Public Name Key 규칙을 그대로 사용합니다.
- `/api/search?q=&official=1`은 official course만 보여주는 catalog filter를 지원합니다. 이 filter는 system/course 결과에만 적용되고 player 결과에는 적용되지 않습니다.
- osu! OAuth authorization code 방식으로 로그인합니다. scope는 `public identify`이며,
  access token과 refresh token은 사용자 확인 뒤 저장하지 않습니다.
- 브라우저에는 7일 고정 만료의 임의 session token만 HttpOnly cookie로 저장하고, DB에는
  SHA-256 hash만 저장합니다. 로그아웃하면 서버 session도 폐기합니다.
- `/settings`는 로그인한 사용자만 접근할 수 있으며 프로필 상세 공개 설정만 제공합니다.
  대표 클리어는 course 상세 페이지에서 관리합니다. 나머지 조회 화면과 검색,
  leaderboard는 로그인 없이 사용할 수 있습니다.
- 로그인한 헤더 username은 My profile, 비활성 My uploads, Settings, Log out을 일반 링크와 버튼으로 제공하는 계정 disclosure를 엽니다. 로그아웃 요청이 실패하면 계정 메뉴를 유지하고 오류를 안내한 뒤 다시 시도할 수 있습니다. 익명 사용자의 Login 버튼은 그대로 유지합니다.
- `/settings`와 player 404는 영어로 표시합니다. player 404는 실제 osu! 계정 여부가 아니라 로컬 로그인 또는 run 기록이 없다는 뜻만 전달합니다.
- 기본은 SSR with server components이며, 전역 검색 dialog, 인증 control, API endpoint만
  필요한 client/route handler 예외를 사용합니다.
