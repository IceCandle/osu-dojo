# osu! API 호출 정책

osu!dojo가 osu! HTTP API를 어디서 왜 부르는지와 호출 제한을 정리합니다. 제품 동작은 `docs/product-contract.md`가 기준이고, 이 문서는 transport와 운영 정책의 기준입니다.

## 현재 호출 경계

| 용도 | 이전 경로 | 현재 경로와 인증 | 실행 시점 |
| --- | --- | --- | --- |
| Beatmap 표시 정보와 object count | `fetchBeatmapMetadata` → v1 `get_beatmaps` | `GET /api/v2/beatmaps?ids[]=` + client credentials | `pnpm metadata:backfill` |
| 완료된 match와 score | `fetchMatchText` → v1 `get_match` | `GET /api/v2/matches/{match}` + client credentials | bot이 map 결과를 확인할 때 |
| 로그인 token 교환 | OAuth authorization code | `POST /oauth/token` + authorization code | 실제 로그인 1회 |
| 로그인 사용자 확인 | v2 `/me/osu` | `GET /api/v2/me/osu` + 사용자 Bearer token | 실제 로그인 1회 |
| bot 사용자 확인 | bancho.js → v1 `get_user` | app adapter → `GET /api/v2/users/{user}/osu` + client credentials | run 시작과 개발용 trigger |
| 로비 beatmap 확인 | bancho.js → v1 `get_beatmaps` | app adapter의 local shim, HTTP 호출 없음 | 로비에서 map을 바꿀 때 |
| 개발용 본인 확인 | `dev-trigger` → bancho.js v1 user 조회 | 위 사용자 adapter와 같은 v2 경로 | `pnpm bot:dev` |

`bancho.js`는 계속 IRC 연결과 로비 제어에 씁니다. 생성할 때 legacy API key를 넘기지 않고, 앱이 소유한 `user.get`, `beatmaps.getByBeatmapId`, `multi.getMatch` adapter를 주입합니다. beatmap adapter는 IRC로 이미 받은 ID를 dependency가 기대하는 모양으로 돌려주는 local shim입니다. 따라서 지원하는 runtime 경로에는 osu! API v1 호출이나 `OSU_API_KEY`가 없습니다. dependency 안의 nodesu 코드는 이 adapter 경로에서 초기화하지 않습니다.

웹 검색, player profile, course 페이지와 DB 시작·seed는 osu! API를 호출하지 않습니다. seed에 metadata가 부족해도 시작을 막지 않으며, 부족한 값은 `pnpm metadata:backfill`로 따로 채웁니다.

web과 bot은 같은 SQLite 파일을 쓰지만 별도 process로 실행됩니다. 따라서 각 process 안의 token cache와 호출 제한도 서로 공유되지 않습니다.

## 인증과 response version

bot 데이터 조회와 metadata backfill은 `OSU_OAUTH_CLIENT_ID`,
`OSU_OAUTH_CLIENT_SECRET`으로 client credentials token을 받습니다. token은 만료 60초 전까지 process 안에서 재사용하고, 동시에 여러 요청이 와도 token 요청은 하나만 보냅니다. API가 401을 반환하면 token을 한 번 강제로 갱신한 뒤 다시 요청합니다.

client credentials로 보내는 공용 v2 요청은 모두 `x-api-version: 20260724`를 보냅니다. 값은 `src/lib/osu/client.ts`의 `OSU_API_RESPONSE_VERSION` 한 곳에서 관리합니다. 로그인용 `/me/osu`는 기존 사용자 OAuth 흐름을 유지합니다.

브라우저의 authorization code 교환과 `/me/osu` 조회는 web process의 사용자 OAuth 경계입니다. bot과 metadata가 쓰는 client-credentials queue를 거치지 않으므로 metadata backfill 대기 때문에 로그인이 막히지 않습니다.

이 값을 바꿀 때는 다음 순서를 따릅니다.

1. 공식 API 문서의 response version 표를 확인합니다.
2. osu-web 전체에서 `api_version()` 호출을 검색하고, 사용하는 user, beatmap, match, score 필드에 영향을 주는 gate를 모두 확인합니다.
3. local DTO와 실제 match fixture를 새 응답에 맞추고 parser 테스트를 먼저 통과시킵니다.
4. `pnpm typecheck && pnpm build && pnpm test`, `pnpm test:e2e`, `pnpm bot:dev`를 다시 확인합니다.

`20260724` pin은 match parser가 사용하는 modern Score shape를 여는 공식 `20220705` Score gate를 포함합니다. 그래서 parser는 `legacy_total_score`, `statistics.great/ok/meh/miss`, acronym mod를 명시적으로 현재 점수 계약으로 바꿉니다. 값을 검토할 때는 공식 문서와 현재 osu-web의 `api_version()` 사용 위치를 함께 확인합니다.

## 호출 속도와 deadline

공식 v2 문서는 분당 60회 이하, 보통 초당 1회 이하를 권고합니다. 현재 적용할 수 있는 legacy v1 공식 제한은 확인되지 않았습니다. v1 wiki의 과거 숫자를 현재 제한으로 사용하지 않습니다. osu!dojo는 process 안에서 용도별 제한을 더 분명하게 둡니다.

| 구분 | process 내 제한 | 대표 용도 |
| --- | ---: | --- |
| run-critical | 분당 60회, 요청 사이 최소 1초 | 사용자, match score |
| metadata | 분당 30회, 요청 사이 최소 2초 | `metadata:backfill` |

두 제한은 같은 process 안에서 각각 순서를 지킵니다. web과 bot의 limiter는 별도 메모리에 있고 여러 process를 합친 전역 제한은 아니므로, 운영할 때 process 수까지 포함해 공식 제한을 넘지 않게 해야 합니다.

`rateLimit`은 호출 간격이고 `deadline`은 한 작업이 끝나야 하는 시각입니다. limiter, 재시도, `Retry-After` 대기는 모두 남은 deadline보다 길 수 없습니다. 남은 시간이 부족하면 기다리지 않고 timeout으로 끝냅니다. 요청 횟수 상한은 따로 두지 않습니다.

- 일반 match 확인: 작업 10초, 요청 1회당 최대 3초
- Bancho가 완료를 확인한 뒤 match 확인: 작업 45초, 요청 1회당 최대 4초
- adapter의 사용자·match 조회: 작업 30초, 요청 1회당 최대 10초
- metadata backfill: 작업 60초, 요청 1회당 최대 10초
- 브라우저 로그인 provider 호출: 요청 1회당 최대 10초

## 오류 처리

app-owned client는 네트워크 오류, 요청 timeout, HTTP 429와 5xx를 deadline 안에서 jitter backoff로 다시 시도합니다. 429의 `Retry-After`가 양수면 그 값을 우선하고, 0이거나 이미 지난 시간이면 jitter backoff를 사용합니다. 영구적인 4xx와 잘못된 JSON/응답 shape는 다시 시도하지 않습니다. token 발급과 응답 본문 읽기는 요청당 10초로 제한하며, 네트워크 오류, 429, 5xx만 다시 시도합니다.

로그인의 authorization code token 교환과 `/me/osu` 조회는 사용자 요청 안의 짧은 대화형 호출입니다. 이 두 호출은 10초 timeout만 적용하고 429, 5xx, 네트워크 오류를 자동 재시도하지 않습니다. 사용자가 로그인부터 다시 시도합니다.

metadata backfill은 성공한 beatmap을 저장하고 실패한 ID와 이유를 출력한 뒤 non-zero 상태로 끝납니다. 다음 실행에서는 아직 부족한 행만 다시 요청합니다.

## 참조

- [osu!api v2 문서](https://osu.ppy.sh/docs/) — OAuth, response version, 분당 60회 권고
- [osu-web API 안내 원문](https://github.com/ppy/osu-web/blob/master/resources/views/docs/info.md.blade.php) — 문서 생성 기준
- [osu-web ScoreTransformer](https://github.com/ppy/osu-web/blob/master/app/Transformers/ScoreTransformer.php) — modern score 필드
- [osu-web LegacyMatch Score](https://github.com/ppy/osu-web/blob/master/app/Models/LegacyMatch/Score.php) — match score와 mod 구성
- [osu!api v1 wiki](https://github.com/ppy/osu-api/wiki) — 이전 endpoint와 과거 분당 1200회, burst 200 설명

v1 wiki의 숫자는 이전 API 기록일 뿐이며 현재 적용 가능한 공식 v1 제한으로 확인되지 않았습니다. v2 호출은 공식 v2 권고와 위 process 제한을 따릅니다.
