# 작업 컨벤션

작업 규칙을 모아 둔 문서입니다. 제품 범위는 `docs/product-contract.md`, epic 상태와 백로그는 `docs/kanban.md`를 기준으로 봅니다.

## Lanes

- Bot Runtime: `src/bot/`, multiplayer lifecycle, score ingestion, timeout, live-check script
- Judgment: `src/lib/accuracy.ts`, `src/lib/judging.ts`, scoring rule, pass/fail behavior, score formatting
- Course Data: `data/courses/`, `src/db/courseLoader.ts`, seed behavior, validation
- Web Catalog: `src/app/`, route rendering, catalog page, leaderboard display, browser smoke check
- Docs: README, product contract, Kanban, onboarding, conventions, roadmap

## Shared Boundaries

`src/db/schema.ts` 또는 `src/lib/domain.ts`를 바꿔야 하면 먼저 영향 범위를 분명히 합니다. 두 파일은 여러 lane에 영향을 주므로, PR notes에 어떤 lane이 영향을 받는지 적습니다.

새 dependency는 현재 stack으로 해결할 수 없는 이유가 있을 때만 추가합니다.

## Testing

`src/lib/` 또는 `src/bot/runtime.ts` 변경은 failing test를 먼저 만들고 통과시키는 흐름을 기본으로 합니다.

UI copy와 styling 변경은 test-first가 필요하지 않습니다. route behavior가 바뀌면 route/render check가 필요합니다.

## Epics and Sub-cards

여러 lane을 건드리는 기능은 `[EP-xx]` parent card와 lane별 sub-card로 나눕니다.

Parent epic card는 Lane `Cross-lane`, Owner, 통합 outcome Summary, Child cards list, 모든 child가 Released된 뒤 확인할 Done when, 통합 Verifier를 가져야 합니다. parent epic은 Backlog에서 Owner `Unassigned`로 시작하고, Next로 옮기기 전에 coordinator owner를 정합니다.

Sub-card는 `Parent: [EP-xx]`를 추가합니다. sub-card는 자기 lane의 outcome을 책임집니다. shared-boundary file을 만지는 경우 parent epic이 그 boundary를 명시하고 PR에서 cross-lane impact를 설명해야 합니다.

`src/lib/domain.ts` 또는 `src/db/schema.ts` 같은 shared-boundary 변경은 epic card에서 조율합니다. parent epic은 child의 `Done when`을 반복하지 않고, specialist는 epic 전체가 아니라 sub-card를 책임집니다.

Verifier는 가능한 한 자동화된 proof를 먼저 둡니다. `pnpm bot:dev <system-name> <course-name>` 같은 live Bancho check는 credential이 필요하므로 선택 사항입니다.

`docs/product-contract.md` 변경은 기능이 실제로 shipped된 뒤 dedicated docs sub-card로만 진행합니다.

## Card Lifecycle

"done"이라는 말은 두 가지 의미로 쓰입니다. `docs/product-contract.md`의 AC1-AC5는 shipped-product gate이고, 각 Kanban card의 `Done when`은 task-level gate입니다.

### Ready for Next

Backlog card는 owner, 한 줄 goal, affected lane, expected verifier shape이 있을 때 Next로 갈 준비가 된 것입니다.

Parent epic은 모든 child card가 ready criteria를 만족하고, 모든 child owner가 정해지고, parent coordinator owner와 epic verifier shape이 있을 때 Next로 갈 준비가 된 것입니다.

### Claiming

card를 맡을 때는 `docs/kanban.md`의 Owner를 바꿉니다. verifier shape이 분명할 때만 같은 PR에서 Backlog card를 In Progress로 옮깁니다.

card가 ready 상태가 아니라면 빠진 verifier를 보완하거나, 시작 전에 Next로 옮길 수 있게 정리합니다.

### Handoff to Review

Review로 옮기기 전 `pnpm build && pnpm test`를 실행합니다. 실행하지 못하면 PR notes에 blocker를 적습니다.

manual route check나 live Bancho check를 했다면 exact command와 outcome을 적습니다.

### Done / Released

task는 `Done when` 조건이 참이고, 필요한 check가 통과하고, unrelated file을 건드리지 않았고, 필요한 manual route/live Bancho check가 기록되었을 때 done입니다.

Released로 옮기는 것은 verifier가 현재 branch에서 green이고, PR이 merge되었고, Kanban 이동이 같은 PR 또는 follow-up docs-only PR에 포함되었을 때만 합니다. Review에서 Released로 옮긴다는 것은 로컬 주장이 아니라 repository 안에서 참이라는 뜻입니다.

## Branches and PRs

carded work는 `lane/card-id-short-summary` 형식의 branch를 씁니다. 예: `bot/br-14-abort-reasons`, `course-data/cd-10-freemod-field`, `docs/dp-30-public-docs`.

작은 uncarded fix는 `docs/typo-readme`처럼 짧은 설명형 branch를 써도 됩니다.

한 PR에는 하나의 scoped card 또는 task만 담습니다. 둘 이상의 lane을 바꾸거나, verifier path가 둘 이상 필요하거나, behavior change와 docs cleanup이 섞이면 PR을 나눕니다.

Cross-lane epic child는 parent epic이 shared boundary를 명시하고 PR description에서 child outcome을 분리해 설명할 수 있을 때만 같은 branch를 공유할 수 있습니다.

PR description에는 실행한 command, manual check, carded work의 Kanban card ID를 적습니다. `.env`, `dojo.db`, log, API key, IRC password, credential은 커밋하지 않습니다.

typo fix, broken link fix, formatting-only cleanup, behavior를 바꾸지 않는 comment는 Kanban card 없이 진행할 수 있습니다. 그래도 PR에는 무엇을 바꿨고 어떤 최소 check를 했는지 적습니다.

이 예외는 product behavior, route, bot runtime, schema/domain type, course data semantic, judgment logic 변경에는 적용하지 않습니다. 그런 변경은 carded work로 두고 verifier를 명확히 합니다.

reviewer는 affected lane에 익숙한 사람이 좋습니다. 좁은 docs, test, single-lane code change는 승인 하나로 충분합니다. shared boundary, live bot behavior, schema/domain type, product-contract wording을 만지면 추가 reviewer를 요청합니다.

reviewer는 style보다 spec compliance, verifier strength, scope control을 먼저 봅니다. 새로운 product idea는 active PR을 키우지 말고 Kanban Backlog로 보냅니다.
