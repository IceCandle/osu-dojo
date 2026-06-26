# osu!dojo

봇이 관리하는 멀티방을 통해 osu! dan course 실력 검증을 자동으로 진행하는 단위인정 플랫폼

플레이어가 봇에게 코스 시작을 요청하면, 봇이 멀티방 생성, 초대, beatmap/mods 설정, 다음 맵 진행, 결과 기록을 처리합니다. 웹사이트에서는 등록된 단, 최근 결과, 검색, 플레이어 프로필을 확인할 수 있습니다.

## 지금 되는 것

- 플레이어가 `!dojo start <system-name> <course-name>`를 봇 DM으로 보내 시작
- 봇이 `(osu!dojo): (<player_name>) vs (<system_name> <course_name>)` 멀티방을 만들고 플레이어 초대
- 코스에 맞는 beatmap과 mods 설정
- osu! Ready 버튼으로 첫 맵과 맵 사이 남은 대기 시간 skip
- 맵 종료 후 rest time 이후 다음 맵 자동 시작
- 맵별 `accuracy`, `score`, `missCount`, `maxCombo` 조건 목록으로 pass/fail 판정
- 결과를 SQLite DB에 저장
- 웹사이트에서 단 목록, pass condition, 최근 결과, 검색, 플레이어 프로필 확인

현재 display name은 영문/숫자와 공백만 지원합니다. 예를 들어 `First Dan`은 public name key `first-dan`으로 사용합니다.

## Contributor Entry Path

1. 현재 제품 범위: [`docs/product-contract.md`](docs/product-contract.md)
2. 작업 현황과 백로그: [GitHub Issues](https://github.com/IceCandle/osu-dojo/issues)
3. 로컬 실행: [`docs/onboarding.md`](docs/onboarding.md)
4. PR/작업 규칙: [`docs/conventions.md`](docs/conventions.md)
5. 코스 JSON 작성법: [`docs/course-authoring.md`](docs/course-authoring.md)
6. 장기 방향: [`docs/roadmap.md`](docs/roadmap.md)

## 자주 쓰는 명령

```bash
pnpm dev
pnpm bot
pnpm bot:dev test 1st
pnpm typecheck
pnpm build
pnpm test
# route/UI 변경 시: pnpm test:e2e
```

`pnpm bot:dev test 1st`는 실제 Bancho에 연결하는 live dev trigger입니다. 로컬 credential이 필요하고, 오프라인 테스트가 아닙니다.

## 로컬 실행

자세한 설정은 [`docs/onboarding.md`](docs/onboarding.md)를 따릅니다.

짧은 흐름:

1. Node.js 20+와 `pnpm` 준비
2. `pnpm install`
3. `.env.example`을 `.env`로 복사하고 osu! IRC/API credential 입력
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`
7. `pnpm dev`

SQLite DB는 첫 실행 시 `data/courses/*.json`과 demo result data로 로컬에 생성됩니다.

## 기술 스택

- 웹: Next.js App Router
- 봇: Node.js + `bancho.js`
- DB: SQLite + Drizzle ORM
- 언어: TypeScript
- 패키지 매니저: `pnpm`
