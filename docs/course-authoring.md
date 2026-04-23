# Course Authoring

course seed 파일은 `data/courses/*.json`에 둡니다. loader는 seed 시점에 이 디렉터리의 JSON 파일을 모두 읽고, 지원하지 않는 형식이면 즉시 실패(fail fast)합니다.

새 course 파일은 코드처럼 다룹니다. 작게 만들고, loader test를 돌리고, 동작 확인(smoke check)을 합니다.

## File Shape

각 파일은 하나의 dan system을 정의합니다.

```json
{
  "id": "system-test",
  "name": "test",
  "slug": "test",
  "description": "Sample dan system.",
  "courses": []
}
```

System fields:

- `id`: seed 저장에 쓰는 고정 문자열 식별자
- `name`: 공개 표시 이름. `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 함
- `slug`: 내부 seed 식별자
- `description`: 카탈로그에 보여줄 설명
- `courses`: course object 배열

각 course object는 아래 형식을 사용합니다.

```json
{
  "id": "course-test-1dan",
  "name": "1st",
  "slug": "test-1dan",
  "description": "Two-map sample course.",
  "status": "draft",
  "ordinal": 1,
  "scoreModel": "scorev2",
  "overallPassType": "acc",
  "overallPassThreshold": 190,
  "beatmaps": []
}
```

Course fields:

- `id`: seed 저장에 쓰는 고정 문자열 식별자
- `name`: 공개 표시 이름. system과 같은 display-name 규칙 사용
- `slug`: 내부 seed 식별자. 공개 명령어에서는 쓰지 않음
- `description`: 카탈로그에 보여줄 설명
- `status`: `draft`, `published`, 또는 `archived`. 생략하면 기존 호환을 위해 `published`로 처리됨
- `tags`: 선택적 문자열 배열
- `ordinal`: system 안에서의 정수 표시 순서
- `scoreModel`: `scorev1` 또는 `scorev2`
- `overallPassType`: `acc`, `score`, 또는 `null`
- `overallPassThreshold`: number. `overallPassType`이 `null`이면 `null`
- `beatmaps`: beatmap object 배열

`overallPassType`이 `acc`이면 `overallPassThreshold`는 평균 accuracy가 아니라 Course Acc와 비교합니다. Course Acc는 통과한 map accuracy의 합계이며 실패했거나 플레이하지 않은 map은 더하지 않습니다. 예를 들어 2-map course에서 대략 95% 평균을 요구하려면 `overallPassThreshold`를 `95`가 아니라 `190`으로 둡니다.

각 beatmap object는 아래 형식을 사용합니다.

```json
{
  "id": "beatmap-test-1",
  "beatmapId": 315,
  "mods": "HR",
  "passConditionType": "acc",
  "passConditionThreshold": 95,
  "ordinal": 1,
  "annotations": ["aim"]
}
```

Beatmap fields:

- `id`: seed 저장에 쓰는 고정 문자열 식별자
- `beatmapId`: osu! beatmap ID 정수
- `mods`: 지원하는 고정 모드 토큰을 하나의 문자열로 묶은 값. `NM`은 빈 문자열로 정규화됨
- `passConditionType`: `acc` 또는 `score`
- `passConditionThreshold`: 선택한 지표와 비교할 숫자
- `ordinal`: course 안에서의 정수 플레이 순서
- `annotations`: 문자열 배열
- `title`, `artist`, `difficultyName`, `mapper`, `coverUrl`: 선택적 메타데이터 문자열. 없으면 seed가 기존 `beatmap_metadata` 캐시를 재사용하거나 osu! API resolver 결과를 저장함

지원하는 모드 토큰은 `EZ`, `NF`, `HT`, `DT`, `HD`, `HR`, `SD`, `NC`, `FL`, `SO`, `PF`, `K4`, `K5`, `K6`, `K7`, `K8`, `FI`, `K9`, `SV2`, `MR`입니다. 지원하지 않는 토큰이나 중복 토큰은 유효성 검사 실패입니다.

## Status and Editing Published Courses

`draft` course는 공개 사이트와 `!dojo start`에서 숨겨집니다. 작성자는 DM으로 `!dojo draft <system-name-key> <course-name-key>`를 보내 로비를 열 수 있습니다. Draft 플레이 결과는 `runs` / `map_results`에 저장되지 않습니다.

`published` course의 게임플레이 정보는 불변입니다. 한 번 publish된 뒤에는 아래 필드를 바꿀 수 없습니다.

- course `ordinal`, `scoreModel`, `overallPassType`, `overallPassThreshold`
- beatmap 추가/삭제
- beatmap `beatmapId`, `mods`, `passConditionType`, `passConditionThreshold`, `ordinal`

공개된 코스에서 gameplay를 고쳐야 하면 기존 코스를 수정하지 말고 복사합니다. 새 `id`, 새 `slug`, 원본과 다른 이름을 쓰고 `status: "draft"`로 시작한 뒤 플레이테스트를 진행합니다. 필요하면 원본 course를 `archived`로 바꾸고 새 course에 `aliases`를 추가해 예전 name key가 새 course로 resolve되게 할 수 있습니다. 이 alias는 리더보드 병합이 아니라 리다이렉트입니다. 기존 점수는 원본 코스에 그대로 남고, 새 플레이는 새 단에 저장됩니다.

Cosmetic edit은 published course에서도 허용됩니다. 현재 in-place로 바꿀 수 있는 것은 `description`, `tags`, 그리고 같은 name key로 resolve되는 `name` 수정입니다. osu! API 메타데이터는 course gameplay row가 아니라 global `beatmap_metadata` cache에 저장되므로 refresh가 허용됩니다.

`archived` course는 공개 catalog, detail page, `!dojo start`에서 제외됩니다. 기존 DB rows는 audit용으로 유지됩니다.

`published_at`은 첫 publish 때 한 번만 기록되고 이후 reseed에서 갱신되지 않습니다.

## Aliases

Course object는 선택적으로 `aliases`를 가질 수 있습니다.

```json
{
  "name": "1st Dan 2026",
  "aliases": ["1st"]
}
```

Alias는 system 안에서만 유효한 public name key redirect입니다. 현재 공개 course name key나 같은 system의 다른 alias와 충돌하면 seed가 실패합니다. Archived course의 old name을 새 published course로 redirect할 수 있지만, 이는 새 course를 시작하게 하는 동작이며 예전 leaderboard를 이어붙이지 않습니다.

## Public Name Keys

플레이어와 라우트는 내부 `slug`가 아니라 display-name key를 사용합니다.

key는 display name을 trim하고, 소문자로 바꾸고, 연속 공백을 `-`로 바꿔 만듭니다.

- System `test` -> `test`
- Course `1st` -> `1st`
- Course `First Dan` -> `first-dan`

loader는 두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 즉시 실패(hard-fail)합니다. 소문자 변환과 공백 정규화 이후에도 display name이 고유하도록 유지합니다.

현재 display name은 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`만 허용합니다. 한글 이름, 구두점, 하이픈은 현재 공개 display-name 규칙에 포함되지 않습니다.

## Validation Checklist

course data PR 전에 확인합니다.

1. `data/courses/` 아래 JSON 파일 추가 또는 수정
2. display name이 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞는지 확인
3. 플레이 가능한 course에 최소 하나의 beatmap이 있고 모든 `ordinal`이 정수인지 확인
4. 통과 조건(pass condition)이 `acc` 또는 `score`만 쓰는지 확인
5. score model이 `scorev1` 또는 `scorev2`만 쓰는지 확인
6. published course의 gameplay field를 바꾸지 않았는지 확인. gameplay 수정이면 clone workflow 사용
7. `pnpm test` 실행
8. `pnpm build` 실행
9. `pnpm dev`를 켜고 `/dan`, `/dan/<system-name-key>?course=<course-name-key>` 확인

실제 Bancho 동작 확인(smoke check)이 필요하면 로컬 credential로 `pnpm bot:dev <system-name-key> <course-name-key>`를 실행합니다. 이 명령은 시작 명령을 한 번 주입한 뒤 REPL을 열어 `!dojo help`, `!dojo prev`, 잘못된 명령 등을 같은 bot process에서 확인할 수 있습니다. Bancho에 연결하므로 일반 course-data PR에서는 선택 사항입니다.

## Common Loader Failures

- 구두점 또는 하이픈이 들어간 이름은 공개 display-name 규칙 위반
- `id`나 `slug`가 달라도 중복된 display-name key면 실패
- `RX` 같은 알 수 없는 mod는 실패
- `annotations`는 문자열이 아니라 문자열 배열이어야 함
- `overallPassType`과 `passConditionType`은 현재 `acc`, `score` 형식만 지원함. 복수 조건 목록은 GitHub Issues에서 추적하며 아직 구현된 동작이 아님
- published 또는 archived course의 gameplay field를 바꾸면 seed가 실패함. 새 course로 clone해야 함
- alias가 현재 공개 name key 또는 다른 alias와 충돌하면 seed가 실패함
