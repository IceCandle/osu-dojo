# Course Authoring

course seed 파일은 `data/courses/*.json`에 둡니다. loader는 seed 시점에 이 디렉터리의 JSON 파일을 모두 읽고, 지원하지 않는 형식이면 즉시 실패(fail fast)합니다.

새 course 파일은 코드처럼 다룹니다. 작게 만들고, loader test를 돌리고, 인계 전에 카탈로그 동작 확인(smoke check)을 합니다.

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

- `id`: seed 저장에 쓰는 고정 문자열 식별자
- `name`: 공개 표시 이름. `^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$`와 맞아야 함
- `slug`: 내부 seed 식별자
- `description`: 카탈로그에 보여줄 설명
- `dans`: course object 배열

각 course object는 아래 형식을 사용합니다.

```json
{
  "id": "dan-test-1dan",
  "name": "1st",
  "courseSlug": "test-1dan",
  "description": "Two-map sample course.",
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
- `courseSlug`: 내부 seed 식별자. 공개 명령어에서는 쓰지 않음
- `description`: 카탈로그에 보여줄 설명
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
- `mods`: 지원하는 고정 모드 토큰을 하나의 문자열로 묶은 값. `NM`은 빈 문자열로 정규화(normalize)됨
- `passConditionType`: `acc` 또는 `score`
- `passConditionThreshold`: 선택한 지표와 비교할 숫자
- `ordinal`: course 안에서의 정수 플레이 순서
- `annotations`: 문자열 배열
- `title`, `artist`, `difficultyName`, `mapper`, `coverUrl`: 선택적 메타데이터 문자열. 없으면 loader가 빈 문자열을 저장하거나 기존 seed 메타데이터를 재사용함

지원하는 모드 토큰은 `EZ`, `NF`, `HT`, `DT`, `HD`, `HR`, `SD`, `NC`, `FL`, `SO`, `PF`, `K4`, `K5`, `K6`, `K7`, `K8`, `FI`, `K9`, `SV2`, `MR`입니다. 지원하지 않는 토큰이나 중복 토큰은 유효성 검사 실패입니다.

## Public Name Keys

플레이어와 라우트는 `slug` 또는 `courseSlug`가 아니라 display-name key를 사용합니다.

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
6. `pnpm test` 실행
7. `pnpm build` 실행
8. `pnpm dev`를 켜고 `/dan`, `/dan/<system-name-key>?course=<course-name-key>` 확인

실제 Bancho 동작 확인(smoke check)이 필요하면 로컬 credential로 `pnpm bot:dev <system-name-key> <course-name-key>`를 실행합니다. Bancho에 연결하므로 일반 course-data PR에서는 선택 사항입니다.

## Common Loader Failures

- 구두점 또는 하이픈이 들어간 이름은 공개 display-name 규칙 위반
- `id`, `slug`, `courseSlug`가 달라도 중복된 display-name key면 실패
- `RX` 같은 알 수 없는 mod는 실패
- `annotations`는 문자열이 아니라 문자열 배열이어야 함
- `overallPassType`과 `passConditionType`은 현재 `acc`, `score` 형식만 지원함. 복수 조건 목록은 GitHub Issues에서 추적하며 아직 구현된 동작이 아님
