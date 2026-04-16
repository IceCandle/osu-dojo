# Course Authoring

course seed file은 `data/courses/*.json`에 둡니다. loader는 seed 시점에 이 디렉터리의 JSON 파일을 모두 읽고, 지원하지 않는 shape이면 fail fast합니다.

새 course file은 코드처럼 다룹니다. 작게 만들고, loader test를 돌리고, handoff 전에 catalog smoke check를 합니다.

## File Shape

각 파일은 하나의 dan system을 정의합니다.

```json
{
  "id": "system-test",
  "name": "test",
  "slug": "test",
  "description": "Sample dan system.",
  "dans": []
}
```

System fields:

- `id`: seed 저장에 쓰는 stable string identifier
- `name`: public display name. `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 함
- `slug`: internal seed identifier
- `description`: catalog에 보여줄 설명
- `dans`: course object 배열

각 course object는 아래 shape을 사용합니다.

```json
{
  "id": "dan-test-1dan",
  "name": "1st",
  "courseSlug": "test-1dan",
  "description": "Two-map sample course.",
  "ordinal": 1,
  "scoreModel": "scorev2",
  "overallPassType": "acc",
  "overallPassThreshold": 95,
  "beatmaps": []
}
```

Course fields:

- `id`: seed 저장에 쓰는 stable string identifier
- `name`: public display name. system과 같은 display-name rule 사용
- `courseSlug`: internal seed identifier. public command에서는 쓰지 않음
- `description`: catalog에 보여줄 설명
- `ordinal`: system 안에서의 integer display order
- `scoreModel`: `scorev1` 또는 `scorev2`
- `overallPassType`: `acc`, `score`, 또는 `null`
- `overallPassThreshold`: number. `overallPassType`이 `null`이면 `null`
- `beatmaps`: beatmap object 배열

각 beatmap object는 아래 shape을 사용합니다.

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

- `id`: seed 저장에 쓰는 stable string identifier
- `beatmapId`: osu! beatmap ID integer
- `mods`: 지원하는 stable mod token을 하나의 string으로 묶은 값. `NM`은 empty string으로 normalize됨
- `passConditionType`: `acc` 또는 `score`
- `passConditionThreshold`: 선택한 metric과 비교할 number
- `ordinal`: course 안에서의 integer play order
- `annotations`: string 배열
- `title`, `artist`, `difficultyName`, `mapper`, `coverUrl`: optional metadata string. 없으면 loader가 empty string을 저장하거나 기존 seeded metadata를 재사용함

지원하는 mod token은 `EZ`, `NF`, `HT`, `DT`, `HD`, `HR`, `SD`, `NC`, `FL`, `SO`, `PF`, `K4`, `K5`, `K6`, `K7`, `K8`, `FI`, `K9`, `SV2`, `MR`입니다. 지원하지 않는 token이나 중복 token은 validation failure입니다.

## Public Name Keys

player와 route는 `slug` 또는 `courseSlug`가 아니라 display-name key를 사용합니다.

key는 display name을 trim하고, lowercase로 바꾸고, whitespace run을 `-`로 바꿔 만듭니다.

- System `test` -> `test`
- Course `1st` -> `1st`
- Course `First Dan` -> `first-dan`

loader는 두 system이 같은 system name key를 만들거나, 한 system 안의 두 course가 같은 course name key를 만들면 hard-fail합니다. lowercase와 whitespace normalization 이후에도 display name이 unique하도록 유지합니다.

현재 display name은 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`만 허용합니다. 한글 이름, punctuation, hyphen은 현재 public display-name contract에 포함되지 않습니다.

## Validation Checklist

course data PR 전에 확인합니다.

1. `data/courses/` 아래 JSON file 추가 또는 수정
2. display name이 `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞는지 확인
3. playable course에 최소 하나의 beatmap이 있고 모든 `ordinal`이 integer인지 확인
4. pass condition이 `acc` 또는 `score`만 쓰는지 확인
5. score model이 `scorev1` 또는 `scorev2`만 쓰는지 확인
6. `pnpm test` 실행
7. `pnpm build` 실행
8. `pnpm dev`를 켜고 `/dan`, `/dan/<system-name-key>?course=<course-name-key>` 확인

live Bancho smoke check가 필요하면 실제 local credential로 `pnpm bot:dev <system-name-key> <course-name-key>`를 실행합니다. Bancho에 연결하므로 일반 course-data PR에서는 선택 사항입니다.

## Common Loader Failures

- punctuation 또는 hyphen이 들어간 name은 public display-name contract 위반
- `id`, `slug`, `courseSlug`가 달라도 duplicate display-name key면 failure
- `RX` 같은 unknown mod는 failure
- `annotations`는 string이 아니라 string 배열이어야 함
- `overallPassType`과 `passConditionType`은 현재 `acc`, `score` shape만 지원함. multiple condition list는 Kanban에 따로 추적하며 아직 shipped behavior가 아님
