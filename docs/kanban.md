# Kanban

이 board는 epic 상태의 source of truth입니다. 새 작업은 Backlog에서 시작하고, owner와 verifier shape이 명확해졌을 때만 Next로 이동합니다. Released는 현재 branch에서 verifier가 passing일 때만 도달합니다.

Card ID는 stable합니다. card를 section 사이에서 옮겨도 renumber하지 않습니다. 두 PR이 동시에 card를 옮긴 경우, merge하는 사람이 stable ID를 유지하면서 두 card movement를 모두 보존합니다.

Cross-lane work는 stable `EP-` parent card와 affected lane별 sub-card를 사용합니다. parent card는 Lane `Cross-lane`, child cards list, `src/lib/domain.ts` 또는 `src/db/schema.ts` 같은 shared-boundary coordination을 담당합니다. sub-card는 `Parent: [EP-xx]`를 추가하고 자기 lane outcome을 책임집니다. parent card도 다른 card와 같은 `#### [ID]` heading shape을 쓰며, child 바로 앞에 둡니다.

## Backlog

#### [JD-10] Multi-ruleset and lazer accuracy support

- Lane: Judgment
- Owner: Unassigned
- Priority: normal
- Summary: stable osu!standard, osu!taiko, osu!catch/ctb, osu!mania, lazer osu!standard score semantic을 위한 explicit score-interpretation layer를 추가합니다.
- Done when: 현재 stable osu!standard scoring은 compatible하게 유지되고, normalized stats가 judgment에 쓰이기 전에 target ruleset/source별 normalization rule이 문서화됩니다.
- Verifier: TBD.

#### [CD-10] Per-beatmap freemod course field

- Lane: Course Data
- Owner: Unassigned
- Priority: normal
- Summary: selected beatmap이 freemod를 사용할 수 있게 하되, freemod를 normal mod token처럼 다루지 않습니다.
- Done when: course data, validation, bot lobby setup, tests가 fixed-mod map과 freemod map을 모두 다룹니다.
- Verifier: TBD.

#### [EP-01] Multiple pass conditions per map/course

- Lane: Cross-lane
- Owner: Unassigned
- Priority: normal
- Summary: 한 specialist가 모든 lane을 떠안지 않도록 나누면서, AND-combined pass condition list를 end-to-end로 지원합니다.
- Shared boundaries: `src/lib/domain.ts` condition-list type shape, storage change가 필요하면 `src/db/schema.ts`. 여기서 coordination하고 실제 edit은 [CD-13]이 담당합니다.
- Child cards: [JD-11], [CD-13], [BR-13], [WC-12], [DP-26]
- Done when: 모든 child card가 Released되고 integrated verifier가 통과합니다.
- Verifier: seeded multi-condition course를 `tests/course-loader.test.ts`, `tests/accuracy.test.ts`, `tests/bot.test.ts`, `tests/web-routes.test.ts`에서 통과시키는 integrated condition-list test path. credential-gated `pnpm bot:dev <system-name> <course-name>`는 optional입니다.

#### [JD-11] Condition-list judging

- Parent: [EP-01]
- Lane: Judgment
- Owner: Unassigned
- Priority: normal
- Summary: `src/lib/judging.ts`에서 per-map과 per-course threshold에 대해 AND-combined pass condition list를 평가합니다.
- Done when: judging이 condition list를 지원하고 all-pass, any-fail, mixed-metric case test가 있습니다. domain type shape은 [CD-13]에서 소비합니다.
- Verifier: `tests/accuracy.test.ts`.

#### [CD-13] Condition-list course data

- Parent: [EP-01]
- Lane: Course Data
- Owner: Unassigned
- Priority: normal
- Summary: condition list를 위한 course JSON shape, loader validation, shared domain type, 필요한 storage change를 정의합니다.
- Done when: course data가 valid condition list를 받고 invalid list shape을 reject하며, downstream lane에서 쓸 shared condition-list type을 노출합니다.
- Verifier: `tests/course-loader.test.ts`.

#### [BR-13] Condition-list bot flow

- Parent: [EP-01]
- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: bot lobby setup과 run flow에서 condition-list course data를 적용합니다.
- Done when: bot runtime이 course attempt에서 condition list를 load하고, single condition을 가정하지 않고 result를 announce합니다.
- Verifier: `tests/bot.test.ts`.

#### [WC-12] Condition-list catalog rendering

- Parent: [EP-01]
- Lane: Web Catalog
- Owner: Unassigned
- Priority: normal
- Summary: dan catalog route에서 map/course별 multiple pass condition을 렌더링합니다.
- Done when: route semantic을 바꾸지 않고 catalog page가 condition list를 명확히 보여줍니다.
- Verifier: `tests/web-routes.test.ts`.

#### [DP-26] Condition-list ship-time docs

- Parent: [EP-01]
- Lane: Docs
- Owner: Unassigned
- Priority: normal
- Summary: condition list가 shipped될 때 public docs를 업데이트합니다.
- Done when: README, product contract, roadmap, Kanban, 필요한 course-authoring note가 ahead-of-scope claim 없이 shipped condition-list behavior를 설명합니다.
- Verifier: [JD-11], [CD-13], [BR-13], [WC-12]가 Released된 뒤 README, `docs/product-contract.md`, `docs/roadmap.md`, 이 board를 manual docs audit합니다.

#### [BR-10] Ready command to skip rest

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: target player가 map 사이에 `!ready`를 보내 남은 countdown을 건너뛸 수 있게 합니다.
- Done when: waiting state에서 target player만 rest를 skip할 수 있고, ignored sender/state test가 있습니다.
- Verifier: TBD.

#### [JD-12] Mode-specific judgment counters

- Lane: Judgment
- Owner: Unassigned
- Priority: low
- Summary: [JD-10]의 normalized score-stats layer 뒤에 taiko, mania, catch/ctb, lazer osu!standard judgment counter를 추가합니다.
- Done when: judgment code가 normalized stats를 통해 counter를 읽고, stable multiplayer score의 raw field 존재를 가정하지 않습니다.
- Verifier: TBD.

#### [BR-11] Bot runtime reliability backlog

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: [BR-14], [BR-15], [BR-16], [BR-17]로 대체되었습니다.
- Done when: reliability child item이 single-deliverable Bot Runtime card로 추적됩니다.
- Verifier: This board.

#### [BR-14] Surface abort reasons

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: 알려진 run-abort path별 stable abort reason을 emit합니다.
- Done when: 각 abort path가 log, test, player-safe explanation에 쓸 수 있는 stable reason을 보고합니다.
- Verifier: `tests/bot.test.ts`.

#### [BR-15] Score-resolution diagnostics

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: live IRC log를 읽지 않아도 score-fetch fallback과 error path를 진단할 수 있게 합니다.
- Done when: missing score, delayed score, API timeout case가 distinct log field와 player-safe message를 만듭니다.
- Verifier: `tests/bot.test.ts`.

#### [BR-16] Restart-safe manual checks

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: bot recovery를 위한 live Bancho restart check를 문서화하거나 자동화합니다.
- Done when: contributor가 `pnpm bot:dev <system-name> <course-name>`로 restart/reconnect check를 실행하고 cleanup과 restart behavior를 확인할 수 있습니다.
- Verifier: `docs/` 아래 written `pnpm bot:dev` restart/reconnect runbook. restart path를 mock Bancho client에서 돌릴 수 있게 되면 `tests/bot.test.ts` coverage로 교체합니다.

#### [BR-17] Command and help consistency

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: normal
- Summary: command parsing, abbreviated input, unknown command, help output을 같은 command surface로 맞춥니다.
- Done when: help text와 command response가 같은 supported command surface를 설명합니다.
- Verifier: `tests/bot.test.ts`.

#### [DP-10] Staff proof review policy

- Lane: Docs
- Owner: Unassigned
- Priority: low
- Summary: replay file 또는 handcam review가 product에 들어갈지 결정합니다.
- Done when: proof review가 scope인지, recorded outcome에 어떤 영향을 주는지 policy가 설명합니다.
- Verifier: TBD.

#### [BR-12] Lazer/API v2 room-control research

- Lane: Bot Runtime
- Owner: Unassigned
- Priority: low
- Summary: 구현 전에 authentication, room control, score payload, live update feasibility를 조사합니다.
- Done when: 짧은 research note가 viable API, blocker, stable IRC를 baseline으로 유지할지 여부를 정리합니다.
- Verifier: TBD.

#### [WC-10] Dynamic profile banner generation

- Lane: Web Catalog
- Owner: Unassigned
- Priority: low
- Summary: hosting, verification URL, abuse handling, proof semantic이 명확해진 뒤 generated pass banner를 검토합니다.
- Done when: cosmetic summary와 official proof를 product decision에서 분리합니다.
- Verifier: TBD.

#### [WC-11] Custom course creation UI

- Lane: Web Catalog
- Owner: Unassigned
- Priority: low
- Summary: auth, ownership, moderation, validation, persistence decision이 명확해진 뒤 write UI를 추가합니다.
- Done when: 누가 course를 만들 수 있는지, invalid/abusive content를 어떻게 처리하는지 design이 정의합니다.
- Verifier: TBD.

#### [JD-13] Pass grade support

- Lane: Judgment
- Owner: Unassigned
- Priority: normal
- Summary: normal pass, gold pass 같은 pass grade tier를 지원합니다.
- Done when: 기존 pass/fail semantic을 깨지 않고 grade threshold, result storage/display 필요사항, migration impact가 implementation 전에 정의됩니다.
- Verifier: product contract update plan과 구현 시 judging tests.

#### [WC-13] Dan search

- Lane: Web Catalog
- Owner: Unassigned
- Priority: normal
- Summary: catalog에서 dan system과 course를 검색할 수 있게 합니다.
- Done when: `/dan`이 public route key를 바꾸지 않고 visible system/course name 기준 search를 지원합니다.
- Verifier: route/render test와 browser smoke check.

#### [WC-14] Admin auth account

- Lane: Web Catalog
- Owner: Unassigned
- Priority: normal
- Summary: future course/result operation을 위한 authenticated admin surface를 정의합니다.
- Done when: UI 구현 전에 auth provider, admin-only operation, credential/storage boundary가 명확히 정리됩니다.
- Verifier: architecture note와 security review before implementation.

#### [WC-15] Difficulty and skillset voting

- Lane: Web Catalog
- Owner: Unassigned
- Priority: normal
- Summary: course의 체감 난이도와 skillset tag에 user voting을 받을 수 있게 합니다.
- Done when: voting identity, abuse prevention, aggregation rule, display policy가 결정됩니다.
- Verifier: product spec과 구현 시 aggregation tests.

#### [WC-20] Polish the dan catalog empty state

- Lane: Web Catalog
- Owner: Unassigned
- Priority: low
- Summary: route나 data shape을 바꾸지 않고 no-systems/no-courses copy를 더 명확히 합니다.
- Done when: empty state가 더 이해하기 쉽고 route behavior는 그대로 유지됩니다.
- Verifier: TBD.

## Next

No cards.

## In Progress

No cards.

## Review

No cards.

## Released

#### [BR-01] Start flow

- Lane: Bot Runtime
- Owner: N/A
- Priority: high
- Summary: player가 `!dojo start <system-name> <course-name>`를 DM으로 보내 multiplayer lobby invite를 받을 수 있습니다.
- Done when: bot이 `osu!dojo:` room을 만들고 requesting player를 초대합니다.
- Verifier: `tests/bot.test.ts`.

#### [BR-02] Name-key validation

- Lane: Bot Runtime
- Owner: N/A
- Priority: high
- Summary: unknown 또는 invalid public name key는 lobby를 만들지 않고 error를 반환합니다.
- Done when: invalid system/course key가 room creation 전에 실패합니다.
- Verifier: `tests/bot.test.ts`.

#### [BR-03] Course sequencing

- Lane: Bot Runtime
- Owner: N/A
- Priority: high
- Summary: bot이 course beatmap을 ordinal order로 load하고 각 completed map 이후 다음 map으로 진행합니다.
- Done when: seeded multi-map course가 first map부터 final result까지 실행됩니다.
- Verifier: `tests/bot.test.ts`.

#### [BR-04] Inactivity abort

- Lane: Bot Runtime
- Owner: N/A
- Priority: normal
- Summary: inactive run은 영원히 멈춰 있지 않고 abort되며 restart path를 남깁니다.
- Done when: stalled pre-join run과 in-progress run이 cleanup되고 fresh start가 가능합니다.
- Verifier: `tests/bot.test.ts`.

#### [BR-05] Lobby cleanup

- Lane: Bot Runtime
- Owner: N/A
- Priority: normal
- Summary: completion, abort, bot shutdown 이후 room을 닫습니다.
- Done when: cleanup이 무한정 block되지 않고 active-run shutdown이 lobby를 닫습니다.
- Verifier: `tests/bot.test.ts`.

#### [JD-01] Per-map pass judgment

- Lane: Judgment
- Owner: N/A
- Priority: high
- Summary: per-map result가 accuracy 또는 score를 map threshold와 비교합니다.
- Done when: accuracy와 score threshold가 올바른 score field를 선택합니다.
- Verifier: `tests/accuracy.test.ts`.

#### [JD-02] Overall pass judgment

- Lane: Judgment
- Owner: N/A
- Priority: high
- Summary: 모든 map이 pass이고 course-level threshold도 pass일 때만 course가 pass됩니다.
- Done when: overall accuracy와 score path가 pass/fail을 모두 올바르게 처리합니다.
- Verifier: `tests/accuracy.test.ts`.

#### [JD-03] Stable osu!standard scoring scope

- Lane: Judgment
- Owner: N/A
- Priority: high
- Summary: 현재 judgment는 stable osu!standard multiplayer score를 대상으로 하며 NF를 강제로 추가합니다.
- Done when: accuracy가 stable hit count를 사용하고 bot setup이 required NoFail behavior를 보존합니다.
- Verifier: `tests/accuracy.test.ts`, `tests/bot.test.ts`.

#### [JD-04] Result announcements

- Lane: Judgment
- Owner: N/A
- Priority: normal
- Summary: bot이 lobby chat에 per-map과 final course outcome을 announce합니다.
- Done when: completed/failed course run이 result message를 emit합니다.
- Verifier: `tests/bot.test.ts`.

#### [CD-01] Name-key derivation

- Lane: Course Data
- Owner: N/A
- Priority: high
- Summary: public system/course key는 display name을 trim, lowercase, whitespace-to-hyphen으로 변환해 만듭니다.
- Done when: command와 route가 internal slug 대신 display-name key를 사용합니다.
- Verifier: `tests/course-loader.test.ts`, `tests/web-routes.test.ts`.

#### [CD-02] Name-key collision hard-fail

- Lane: Course Data
- Owner: N/A
- Priority: high
- Summary: course loading이 duplicate system/course name key를 reject합니다.
- Done when: duplicate display-name key가 load time에 실패합니다.
- Verifier: `tests/course-loader.test.ts`.

#### [CD-03] JSON course authoring surface

- Lane: Course Data
- Owner: N/A
- Priority: normal
- Summary: seed course data는 `data/courses/` 아래 JSON file에서 옵니다.
- Done when: loader가 seeded JSON을 읽고 unsupported shape을 reject합니다.
- Verifier: `tests/course-loader.test.ts`, `tests/db-and-pages.test.ts`.

#### [WC-01] Home system overview

- Lane: Web Catalog
- Owner: N/A
- Priority: high
- Summary: `/`가 dan system과 course를 보여줍니다.
- Done when: home route가 seeded system data를 렌더링합니다.
- Verifier: `tests/db-and-pages.test.ts`, `tests/web-routes.test.ts`.

#### [WC-02] Dan catalog

- Lane: Web Catalog
- Owner: N/A
- Priority: high
- Summary: `/dan`이 dan system을 catalog 형태로 보여줍니다.
- Done when: catalog route가 seeded system을 렌더링하고 detail route로 link합니다.
- Verifier: `tests/db-and-pages.test.ts`, `tests/web-routes.test.ts`.

#### [WC-03] Dan system detail route

- Lane: Web Catalog
- Owner: N/A
- Priority: high
- Summary: `/dan/[systemNameKey]?course=<courseNameKey>`가 모든 course를 렌더링하고 selected-course anchor를 지원합니다.
- Done when: detail route가 course data, beatmap, pass condition, leaderboard state를 렌더링합니다.
- Verifier: `tests/web-routes.test.ts`.

#### [WC-04] Read-only SSR catalog

- Lane: Web Catalog
- Owner: N/A
- Priority: normal
- Summary: site는 read-only, unauthenticated, server-rendered입니다.
- Done when: public catalog page가 auth 또는 write action 없이 렌더링됩니다.
- Verifier: `src/app/`, `tests/web-routes.test.ts`.

#### [DP-01] Product contract source

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: `docs/product-contract.md`가 현재 shipped behavior와 scope를 설명합니다.
- Done when: README와 roadmap이 current scope 기준으로 product contract를 가리킵니다.
- Verifier: `README.md`, `docs/roadmap.md`, `docs/product-contract.md`.

#### [DP-02] Kanban source

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: `docs/kanban.md`가 epic status의 single source입니다.
- Done when: public docs가 예전 작업 queue 대신 Kanban을 가리킵니다.
- Verifier: `README.md`, `docs/onboarding.md`, `docs/contributing.md`, `docs/roadmap.md`.

#### [DP-03] Contributor-safe docs prep

- Lane: Docs
- Owner: N/A
- Priority: normal
- Summary: contributor setup, PR entry rule, roadmap, current-scope docs를 private planning reference 없이 제공합니다.
- Done when: public docs가 private/tooling reference를 피하고 setup과 first-task path를 제공합니다.
- Verifier: `docs/onboarding.md`, `docs/contributing.md`, `docs/roadmap.md`.

#### [DP-20] Attach verifier links to Released cards

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: 모든 Released card를 source, test, manual verification과 대조합니다.
- Done when: 모든 Released card가 concrete verifier를 가지고, unverified claim은 Released 밖으로 이동합니다.
- Verifier: 이 파일을 `tests/bot.test.ts`, `tests/accuracy.test.ts`, `tests/course-loader.test.ts`, `tests/db-and-pages.test.ts`, `tests/web-routes.test.ts`, README, `docs/product-contract.md`, `docs/roadmap.md`, `src/app/`와 manual audit합니다.

#### [CD-11] Course authoring guide and validation checklist

- Lane: Course Data
- Owner: N/A
- Priority: high
- Summary: real course JSON을 안전하게 추가하는 방법을 문서화합니다.
- Done when: required field, name-key rule, smoke check, validation failure가 문서화됩니다.
- Verifier: `docs/course-authoring.md`, `src/db/courseLoader.ts`, `tests/course-loader.test.ts`.

#### [DP-25] Define fuller team operating rules

- Lane: Docs
- Owner: N/A
- Priority: normal
- Summary: branch naming, PR size, review expectation, handoff rule을 conventions에 확장합니다.
- Done when: `docs/conventions.md`가 product contract를 반복하지 않고 full team workflow를 다룹니다.
- Verifier: `docs/conventions.md`.

#### [DP-30] Tracked public-doc coherence

- Lane: Docs
- Owner: N/A
- Priority: high
- Summary: public contributor reading path를 tracked docs로 제한하고 stale private-planning reference를 제거합니다.
- Done when: README, onboarding, contributing, Kanban, product contract, roadmap, conventions가 current public docs만 link합니다.
- Verifier: public doc set stale-reference scan이 예전 queue/spec, 로컬 계획 문서, 비공개 조사 자료를 찾지 않습니다.
