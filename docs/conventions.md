# 작업 컨벤션

작업 규칙을 모아 둔 기준 문서입니다. 현재 동작 기준은 `docs/product-contract.md`, 예정 작업과 논의는 GitHub Issues를 기준으로 봅니다. `docs/product-contract.md`에는 제품 동작만 적고, 작업 방식은 이 문서에 둡니다.

## Areas

- Bot: `src/bot/`, 멀티플레이어 생명주기, 점수 수집, timeout, 실제 연결 확인 스크립트. GitHub label: `area:bot`
- Web: `src/app/`, 라우트 렌더링, 카탈로그 페이지, 리더보드 표시, 브라우저 동작 확인. GitHub label: `area:web`
- DB: `src/db/`, `data/courses/`, course loader, seed 동작, course data 유효성 검사, 결과 저장. GitHub label: `area:db`
- Docs: README, 동작 기준 문서, onboarding, conventions, roadmap, runbook. GitHub label: `documentation`

`src/lib/accuracy.ts`, `src/lib/judging.ts` 같은 판정 로직은 별도 area가 아니라 shared logic입니다. 판정 변경은 PR description의 What Changed와 verifier에 명확히 적고, issue가 있으면 title에 `[Judgment]`를 씁니다.

`chore`는 hosting, backup, repo/process cleanup처럼 제품 기능은 아니지만 해야 하는 작업에 씁니다. 구현 전에 결정이 필요한 작업은 `question`을 씁니다.

## Scope

`docs/product-contract.md`는 현재 구현된 동작만 설명합니다. 예정 기능이나 아이디어는 GitHub Issues에 둡니다.

`docs/product-contract.md` 변경은 기능이 실제로 구현된 뒤에만 합니다. 구현 전 정책, 설계, 방향 논의는 issue나 `docs/roadmap.md`에 둡니다. PR에는 `.github/pull_request_template.md`를 사용합니다.

## Shared Boundaries

도메인 용어는 `DanSystem -> Course -> Beatmap`과 `CourseRun -> MapResult`를 기준으로 씁니다. `DanSystem`은 `danSystem*` prefix를 유지하고, 플레이 가능한 단위는 `dan`이 아니라 `course`로 부릅니다. system과 course 모두 자기 객체 안에서는 `slug`를 쓰며, 평탄화된 course 객체에서만 부모 system slug를 `danSystemSlug`로 구분합니다.

`src/db/schema.ts` 또는 `src/lib/domain.ts`를 바꿔야 하면 PR notes에 영향 범위를 적습니다. 두 파일은 여러 area에 영향을 주므로 관련 issue나 tracking issue에서 먼저 경계를 분명히 합니다.

새 dependency는 현재 stack으로 해결할 수 없는 이유가 있을 때만 추가합니다.

구현은 기존 패턴을 먼저 따릅니다. 불필요한 factory, DI, 미래 대비 abstraction은 만들지 않고, 3개 이상 call site가 생기거나 명확한 domain boundary가 있을 때만 추출합니다. 죽은 코드는 주석 처리하지 말고 삭제합니다.

## Issues

GitHub issue는 누군가 나중에 집어 들어도 무엇을 끝내야 하는지 알 수 있을 만큼만 씁니다.

기본 구조:

```md
## Summary

## Done when

## Verifier
```

여러 area를 건드리고 3개 이상 독립적으로 검증할 수 있는 작업은 parent tracking issue를 둡니다. milestone은 release/readiness bucket에만 씁니다.

## Testing

bot 실행 로직, 공용 판정 로직(`src/lib/`), DB 조회, 명령 파싱, 판정, 점수/결과 계약의 동작을 바꾸는 작업은 실패하는 테스트를 먼저 만들고 통과시키는 흐름을 기본으로 합니다. 예외는 문서만 바꾸는 작업, 순수 UI 문구/스타일, 기계적인 fixture 수정, 긴급 되돌리기입니다.

UI 문구와 스타일 변경은 test-first가 필요하지 않습니다. 라우트 동작이 바뀌면 라우트/렌더 확인이 필요합니다.

검토로 넘기기 전 `pnpm typecheck && pnpm build && pnpm test`를 실행합니다. 실행하지 못하면 PR notes에 이유를 적습니다.

공유 SQLite의 WAL / `busy_timeout`, 재시도 가능한 네트워크 오류의 지터 백오프 같은 기본 복구 장치는 최적화가 아니라 안정성 기준입니다.

browser verification, link check, browser-driven flow는 `playwright-cli`를 먼저 씁니다. 환경 제약으로 막히면 임의 수동 확인으로 대체하기 전에 blocker를 기록합니다.

## Branches and PRs

Issue가 있는 작업은 짧은 설명형 branch를 씁니다. 예: `bot/abort-reasons`, `web/dan-search`, `docs/course-edit-policy`.

한 PR에는 하나의 범위가 정해진 issue 또는 task만 담습니다. 둘 이상의 area를 바꾸거나, 검증 경로가 둘 이상 필요하거나, 동작 변경과 docs 정리가 섞이면 PR을 나눌지 먼저 판단합니다.

PR description에는 관련 issue, 실행한 명령어, 수동 확인을 적습니다.

오타 수정, 깨진 링크 수정, 포맷 정리, 동작을 바꾸지 않는 주석은 issue 없이 진행할 수 있습니다. 그래도 PR에는 무엇을 바꿨고 어떤 최소 확인을 했는지 적습니다.

이 예외는 동작, 라우트, bot runtime, schema/domain type, course data 의미, 판정 로직 변경에는 적용하지 않습니다. 그런 변경은 issue로 추적하고 verifier를 명확히 합니다.

reviewer는 스타일보다 사양 준수, 검증 강도, 범위 관리를 먼저 봅니다. 새로운 아이디어는 진행 중인 PR을 키우지 말고 새 issue로 보냅니다.

작업 완료 기준은 acceptance criteria 통과, `pnpm typecheck && pnpm build && pnpm test` 성공, unrelated file 변경 없음, 새 dependency justification, 그리고 필요한 수동 확인 기록입니다.
