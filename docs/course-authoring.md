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

Course 전체 조건 type은 `courseAccuracy`, `totalScore`, `totalMissCount`입니다. 조건 목록은 AND로 결합되며, 같은 목록 안에서 같은 type은 한 번만 쓸 수 있습니다. `courseAccuracy`는 평균 accuracy가 아니라 Course Acc와 비교합니다. Course Acc는 통과한 map accuracy의 합계입니다. `totalScore`는 `scoreModel: "scorev2"` course에서만 사용할 수 있고, `scorev1` course에 쓰면 load 시점에 실패합니다.

각 beatmap object는 아래 형식을 사용합니다.

```json
{
  "id": "beatmap-test-1",
  "beatmapId": 315,
  "mods": "HR",
  "freemod": false,
  "passConditions": [{ "type": "accuracy", "threshold": 95 }],
  "ordinal": 1,
  "annotations": ["aim"]
}
```

Beatmap field:

- `id`: DB에 저장되는 고정 문자열 식별자
- `beatmapId`: osu! beatmap ID 정수
- `mods`: 지원하는 고정 모드 토큰을 이어 붙인 문자열. `NM`은 빈 문자열로 정규화됨
- `freemod`: 선택 field. `true`이면 해당 map에서만 Bancho FreeMod를 켜고, 플레이어가 `HD`, `HR`, `HDHR` 중 하나를 선택할 수 있음. 생략하면 `false`
- `passConditions`: map 통과 조건 배열. 최소 하나 이상의 조건 필요
- `ordinal`: course 안에서의 플레이 순서
- `annotations`: 문자열 배열
- `title`, `artist`, `difficultyName`, `mapper`, `coverUrl`: 선택적 메타데이터 문자열

Map 조건 type은 `accuracy`, `score`, `missCount`, `maxCombo`입니다. 조건 목록은 AND로 결합되며, 같은 목록 안에서 같은 type은 한 번만 쓸 수 있습니다. `score`는 `scoreModel: "scorev2"` course에서만 사용할 수 있고, `scorev1` course에 쓰면 load 시점에 실패합니다.

비교 방향:

- `accuracy`, `score`, `maxCombo`, `courseAccuracy`, `totalScore`: 실제 값이 threshold 이상이어야 통과
- `missCount`, `totalMissCount`: 실제 값이 threshold 이하여야 통과

Threshold 검증:

- `accuracy`: 0 이상 100 이하 number
- `courseAccuracy`: 0 이상 `map 수 * 100` 이하 number
- `score`, `totalScore`, `missCount`, `totalMissCount`, `maxCombo`: 0 이상의 정수. `score`와 `totalScore`는 ScoreV2 course 전용

지원하는 모드 토큰은 `EZ`, `NF`, `HT`, `DT`, `HD`, `HR`, `SD`, `NC`, `FL`, `SO`, `PF`, `K4`, `K5`, `K6`, `K7`, `K8`, `FI`, `K9`, `SV2`, `MR`입니다. `FM`은 mod 문자열에 쓰지 않고 beatmap의 `"freemod": true`로 설정합니다. 웹 catalog는 freemod beatmap을 `+FM`으로 표시하고 mod token은 색으로 구분합니다. 플레이어가 실제로 고른 mod는 runtime/audit 데이터이며 catalog page에는 표시하지 않습니다.

## FreeMod와 ScoreV2 score

`freemod: true`인 beatmap은 로비에서 해당 map에만 FreeMod를 켭니다. 플레이어가 추가로 고를 수 있는 mod는 `NM`, `HD`, `HR`, `HDHR`뿐입니다. `NF`는 사망 후 score 제출 안정성을 위한 선택 사항입니다. `EZ`, `FL`, `DT`, `NC`, key mod 등 다른 선택이 match result에 있으면 해당 map은 실패로 저장되고, bot이 거부된 mod를 로비에 알립니다.

ScoreV2 course의 `score`와 `totalScore` threshold는 adjusted(NM-equivalent) 기준으로 작성합니다. Bot은 Bancho raw ScoreV2를 플레이한 mod multiplier로 나눈 뒤 threshold와 비교합니다. 저장된 `MapResult.score`는 adjusted 판정 점수이고, `MapResult.rawScore`는 Bancho API raw score입니다. `rawScore`는 audit과 lobby의 raw 목표 안내에만 씁니다. Leaderboard는 adjusted `score` 합계 기준으로 정렬합니다.

ScoreV2 course의 player-facing 표기는 비교 상황에 맞춰 scale을 명시합니다.

- 고정 mod 맵의 pre-map target과 result line은 `raw score`입니다. osu!가 화면에 표시하는 값과 같은 scale입니다.
- FreeMod 맵의 pre-map target은 `adjusted score`이며, 같은 화면의 `Raw score by choice`가 허용된 mod 조합별 raw 값을 나열합니다. Post-map result line은 player가 실제 선택한 mod 조합 기준의 `raw score`입니다.
- 최종 맵은 map-level score threshold와 course-level `totalScore` remaining을 하나의 effective adjusted target으로 합칩니다. effective 값은 `max(map score threshold, totalScore remaining, 0)`입니다. 고정 mod이면 `Targets:` 안에 `raw score >= N`을 합쳐 표시하고, FreeMod이면 `Targets:` 안에 `adjusted score >= N`을 표시한 뒤 target이 있을 때만 `Raw score by choice: ...` support line을 추가합니다. map `score` 조건이 있으면 그 위치를 유지하고, 없으면 마지막 segment로 추가합니다. 이미 `Course cannot pass:`가 표시된 run에서는 이후 final-map `totalScore` remaining을 pre-map target에 다시 합치지 않습니다.
- completed full map 뒤에는 course 조건 순서대로 `Course targets: courseAccuracy X / Y; adjusted total score X / Y; totalMissCount X / Y`처럼 진행도를 표시합니다. Partial play는 해당 map에서 이 줄을 즉시 표시하지 않지만, partial 결과의 score와 miss는 이후 진행도 totals에 포함됩니다.
- 누적 진행도는 run 종료 시 `adjusted total score:`, leaderboard에서는 `Adjusted Score Total`로 표시합니다.
- 진행 중 course 통과 불가능 안내는 threshold-level reason을 씁니다: `map N threshold failed`, `totalMissCount threshold exceeded`, `courseAccuracy threshold unreachable`.
- Human-facing map announcement에서는 강제 `NF`를 숨기지만, 실제 lobby 설정에는 `!mp mods`로 `NF`를 포함합니다.

ScoreV2 multiplier는 다음 기준을 씁니다.

| mod | multiplier |
| --- | ---: |
| `EZ` | 0.5 |
| `NF` | 1.0 |
| `HT` | 0.3 |
| `HD` | 1.06 |
| `HR` | 1.1 |
| `DT` / `NC` | 1.2 |
| `FL` | 1.12 |
| `SO` | 0.9 |
| `SD` / `PF` | 1.0 |

예시:

- FreeMod `score >= 1_000_000`: HDHR raw 1,166,000은 adjusted 1,000,000으로 통과하고, HR raw 1,099,999는 adjusted 999,999로 실패합니다.
- Fixed `mods: "DT"`에서 `score >= 1_000_000`: raw 1,200,000 DT play는 adjusted 1,000,000으로 통과하고, raw 1,199,999는 실패합니다.
- `totalScore >= 3_000_000`: 각 map의 adjusted `score` 합계가 3,000,000 이상이어야 합니다.

`SV2` mod token은 stable에서 lazer ScoreV2 표시를 켜는 mod token입니다. Course의 `scoreModel: "scorev2"`와 같은 의미가 아닙니다.

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
- beatmap `id`, `beatmapId`, `mods`, `freemod`, `passConditions`, `ordinal`

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
7. `scorev1` course에 `score` 또는 `totalScore` 조건이 없는지 확인
8. frozen system의 gameplay field를 바꾸지 않았는지 확인
9. `pnpm test` 실행
10. `pnpm build` 실행
11. `pnpm dev`를 켜고 `/dan`, `/dan/<system-name-key>?course=<course-name-key>` 확인

실제 Bancho 동작 확인이 필요하면 `pnpm bot:dev <system-name-key> <course-name-key>`를 실행합니다.
