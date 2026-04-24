# Course Authoring

course seed 파일은 `data/courses/*.json`에 둡니다. seed 시점에는 이 디렉터리의 JSON 파일을 모두 읽고, 지원하지 않는 형식이면 즉시 실패합니다.

## 파일 구조

각 파일은 하나의 dan system을 정의합니다.

```json
{
  "id": "system-test",
  "name": "test",
  "slug": "test",
  "description": "Sample dan system.",
  "status": "current",
  "courses": []
}
```

System field:

- `id`: DB에 저장되는 고정 문자열 식별자
- `name`: 공개 표시 이름. `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 함
- `slug`: 내부 seed 식별자
- `description`: catalog와 detail page에 보여줄 설명
- `status`: `draft`, `current`, `legacy`, `archived` 중 하나. 생략하면 `current`
- `courses`: course object 배열

각 course object는 아래 형식을 사용합니다.

```json
{
  "id": "course-test-1dan",
  "name": "1st",
  "slug": "test-1dan",
  "description": "Two-map sample course.",
  "ordinal": 1,
  "scoreModel": "scorev2",
  "overallPassConditions": [{ "type": "courseAccuracy", "threshold": 190 }],
  "beatmaps": []
}
```

Course field:

- `id`: DB에 저장되는 고정 문자열 식별자
- `name`: 공개 표시 이름. system과 같은 display-name 규칙 사용
- `slug`: 내부 seed 식별자. 공개 명령어와 URL에서는 쓰지 않음
- `description`: detail page에 보여줄 설명
- `tags`: 선택적 문자열 배열
- `ordinal`: system 안에서의 표시 순서
- `scoreModel`: `scorev1` 또는 `scorev2`
- `overallPassConditions`: course 전체 통과 조건 배열. 비어 있으면 map별 조건만 사용
- `beatmaps`: beatmap object 배열

Course 전체 조건 type은 `courseAccuracy`, `totalScore`, `totalMissCount`입니다. 조건 목록은 AND로 결합되며, 같은 목록 안에서 같은 type은 한 번만 쓸 수 있습니다. `courseAccuracy`는 평균 accuracy가 아니라 Course Acc와 비교합니다. Course Acc는 통과한 map accuracy의 합계입니다.

각 beatmap object는 아래 형식을 사용합니다.

```json
{
  "id": "beatmap-test-1",
  "beatmapId": 315,
  "mods": "HR",
  "passConditions": [{ "type": "accuracy", "threshold": 95 }],
  "ordinal": 1,
  "annotations": ["aim"]
}
```

Beatmap field:

- `id`: DB에 저장되는 고정 문자열 식별자
- `beatmapId`: osu! beatmap ID 정수
- `mods`: 지원하는 고정 모드 토큰을 이어 붙인 문자열. `NM`은 빈 문자열로 정규화됨
- `passConditions`: map 통과 조건 배열. 최소 하나 이상의 조건 필요
- `ordinal`: course 안에서의 플레이 순서
- `annotations`: 문자열 배열
- `title`, `artist`, `difficultyName`, `mapper`, `coverUrl`: 선택적 메타데이터 문자열

Map 조건 type은 `accuracy`, `score`, `missCount`, `maxCombo`입니다. 조건 목록은 AND로 결합되며, 같은 목록 안에서 같은 type은 한 번만 쓸 수 있습니다.

비교 방향:

- `accuracy`, `score`, `maxCombo`, `courseAccuracy`, `totalScore`: 실제 값이 threshold 이상이어야 통과
- `missCount`, `totalMissCount`: 실제 값이 threshold 이하여야 통과

Threshold 검증:

- `accuracy`: 0 이상 100 이하 number
- `courseAccuracy`: 0 이상 `map 수 * 100` 이하 number
- `score`, `totalScore`, `missCount`, `totalMissCount`, `maxCombo`: 0 이상의 정수

지원하는 모드 토큰은 `EZ`, `NF`, `HT`, `DT`, `HD`, `HR`, `SD`, `NC`, `FL`, `SO`, `PF`, `K4`, `K5`, `K6`, `K7`, `K8`, `FI`, `K9`, `SV2`, `MR`입니다.

## System Status

상태는 system에만 둡니다. Course는 system의 상태를 상속하며, course object에는 별도 status를 쓰지 않습니다.

| 상태 | catalog 공개 | exact key 접근 | gameplay 수정 | run 저장 |
| --- | --- | --- | --- | --- |
| `current` | 공개 | 가능 | 불가 | 저장 |
| `legacy` | current 아래에 공개 | 가능 | 불가 | 저장 |
| `draft` | 비공개 | 가능 | 가능 | 저장 안 함 |
| `archived` | 비공개 | 불가 | 불가 | 저장 안 함 |

시작 명령은 항상 `!dojo start <system-name-key> <course-name-key>`입니다. draft도 같은 명령으로 시작하지만 결과는 `runs` / `map_results`에 저장하지 않습니다.

`current`, `legacy`, `archived` system은 frozen 상태입니다. Frozen system에서는 아래 gameplay field를 바꿀 수 없습니다.

- course 추가/삭제
- course `id`, `slug`, name key, `ordinal`, `scoreModel`, `overallPassConditions`
- beatmap 추가/삭제
- beatmap `id`, `beatmapId`, `mods`, `passConditions`, `ordinal`

허용되는 cosmetic edit은 system `description`, 같은 key를 유지하는 system `name`, course `description`, course `tags`, 같은 key를 유지하는 course `name`, beatmap metadata cache입니다.

## 연간 롤오버

새 버전은 기존 system을 직접 고치지 않고 새 system 파일로 추가합니다.

1. 기존 `data/courses/genocide.json`을 legacy로 바꿉니다. 예: `name: "genocide 2007"`, `slug: "genocide-2007"`, `status: "legacy"`. system/course/beatmap `id`는 그대로 둬서 기존 점수가 같은 course에 남게 합니다.
2. 새 `data/courses/genocide-2018.json`을 추가합니다. 새 system `id`, `name: "genocide"`, `status: "current"`, 새 course/beatmap `id`를 사용합니다.
3. `/dan/genocide`는 current version을 보여주고, `/dan/genocide-2007`는 legacy version을 보여줍니다. legacy overjoy course 명령은 `!dojo start genocide-2018 overjoy`처럼 표시됩니다.

Frozen 이후 이름을 바꿀 수 있는 유일한 경우는 `current -> legacy` 입니다. Course name key는 시스템이 draft를 벗어난 뒤에는 바꾸지 않습니다.

## Public Name Key

플레이어와 route는 내부 `slug`가 아니라 display-name key를 사용합니다.

key는 display name을 trim하고, 소문자로 바꾸고, 연속 공백을 `-`로 바꿔 만듭니다.

- Course `First Dan` -> `first-dan`

두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 loader가 즉시 실패합니다.

## 확인 목록

course data를 바꾸기 전에 아래를 확인합니다.

1. `data/courses/` 아래 JSON 파일을 추가 또는 수정했는지 확인
2. display name이 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞는지 확인
3. 플레이 가능한 course에 최소 하나의 beatmap이 있는지 확인
4. 모든 `ordinal`이 정수인지 확인
5. condition list가 map에는 비어 있지 않고, 같은 list 안에서 type이 중복되지 않는지 확인
6. score model이 `scorev1` 또는 `scorev2`만 쓰는지 확인
7. frozen system의 gameplay field를 바꾸지 않았는지 확인
8. `pnpm test` 실행
9. `pnpm build` 실행
10. `pnpm dev`를 켜고 `/dan`, `/dan/<system-name-key>?course=<course-name-key>` 확인

실제 Bancho 동작 확인이 필요하면 `pnpm bot:dev <system-name-key> <course-name-key>`를 실행합니다.
