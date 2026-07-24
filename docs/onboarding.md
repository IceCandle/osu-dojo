# 온보딩

깨끗한 clone에서 로컬 실행까지 가는 절차입니다.

## Requirements

- Node.js 20+
- pnpm 10.6+
- osu! legacy API key와 IRC credential for live bot checks

## Local Run

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Create `.env`.

   ```bash
   cp .env.example .env
   ```

3. Fill env values.

   ```env
   OSU_IRC_USERNAME=
   OSU_IRC_PASSWORD=
   OSU_API_KEY=
   DATABASE_URL=file:./dojo.db
   DOJO_SITE_URL=http://localhost:3000
   SESSION_SECRET=
   OSU_OAUTH_CLIENT_ID=
   OSU_OAUTH_CLIENT_SECRET=
   ```

   `SESSION_SECRET`은 UTF-8 기준 32 byte 이상이어야 합니다. `DOJO_SITE_URL`은
   경로나 query가 없는 현재 사이트 origin입니다. osu! account settings에서 OAuth
   application을 만들고 callback URL을
   `http://localhost:3000/api/auth/osu/callback`으로 정확히 등록한 뒤 client ID와
   secret을 입력합니다.

4. Run checks and site.

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm dev
   ```

   If you pulled the system-lifecycle schema change over an older local checkout,
   delete `dojo.db` first and let `pnpm dev` reseed it.

5. Check routes.

   - `http://localhost:3000/`
   - `http://localhost:3000/dan`
   - `http://localhost:3000/dan/test?course=1st`
   - `http://localhost:3000/players/<userId>`
   - `http://localhost:3000/settings` (로그인 필요)

웹 서버는 시작할 때 인증 환경 변수를 검사합니다. Next.js 14의
`instrumentation.ts`와 `experimental.instrumentationHook`을 사용하므로 잘못된 값이
있으면 첫 인증 요청까지 기다리지 않고 서버 시작이 실패합니다. Bot 실행에는 이 웹
인증 환경 변수가 필요하지 않습니다.

### 로컬 dummy 로그인

실제 osu! OAuth application 없이 로그인 화면과 사용자별 UI를 확인하려면 `.env`에서
`DOJO_E2E_AUTH=1`을 사용합니다. 이 모드는 `DOJO_SITE_URL`이 `localhost`,
`127.0.0.1`, `[::1]` 중 하나일 때만 동작하며, 고정 dummy 계정 `E2EPlayer`(user ID
`77`)로 로그인합니다. 외부에서 접근 가능한 환경에서는 사용하지 않습니다.

```env
DOJO_SITE_URL=http://localhost:3000
# `openssl rand -base64 48` 결과를 붙여 넣습니다.
SESSION_SECRET=
DOJO_E2E_AUTH=1
OSU_OAUTH_CLIENT_ID=
OSU_OAUTH_CLIENT_SECRET=
```

dummy mode에서도 `SESSION_SECRET`은 UTF-8 기준 32 byte 이상이어야 합니다. 이때는
`OSU_OAUTH_CLIENT_ID`와 `OSU_OAUTH_CLIENT_SECRET`을 비워 둘 수 있습니다. Login을
누르면 로컬 dummy authorize route를 거쳐 일반 OAuth와 같은 session cookie가
생성됩니다.

## 봇 확인

`pnpm bot`은 live IRC bot process를 실행합니다.

`pnpm bot:dev test 1st`는 본인 계정으로 Bancho에 연결해서 `!dojo start test 1st`를 주입한 뒤 `!dojo` 명령을 직접 입력할 수 있는 REPL을 엽니다. `pnpm bot:dev`처럼 인자 없이 실행하면 시작 명령 주입 없이 REPL만 엽니다. 오프라인 테스트가 아니며, 방이 생성되면 터미널에 멀티방 링크가 출력됩니다.

## 주요 위치

- 웹사이트: `src/app/`
- 봇 process: `src/bot/index.ts`
- 봇 factory와 test seam: `src/bot/runtime.ts`
- 코스 데이터: `data/courses/`
- 코스 작성 가이드: `docs/course-authoring.md`
- 도메인과 판정 로직: `src/lib/`

## Next Docs

Contributor entry path는 `README.md`, PR 규칙은 `docs/conventions.md`.
