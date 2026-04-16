# Roadmap

이 문서는 방향을 잡아 두는 aspirational note입니다. 현재 제품 범위는 `docs/product-contract.md`, queued work는 `docs/kanban.md`를 기준으로 봅니다.

## Vision

osu!dojo의 핵심 가치는 자동 forced-start dan lobby flow입니다. player가 course를 요청하면 bot이 multiplayer room을 만들고 운영하며, site가 결과를 기록합니다.

## Phase 1: Current Shipped Scope

- Bancho IRC 기반 자동 dan lobby. Source: `docs/product-contract.md` AC1-AC2
- stable osu!standard multiplayer score ingestion과 judgment. Source: `docs/product-contract.md` AC3-AC4
- `/`, `/dan`, `/dan/[systemNameKey]?course=<courseNameKey>`의 read-only course/result catalog. Source: `docs/product-contract.md` AC5

## Phase 2: Near-Term Hardening

- abort reason, score-resolution diagnostics, restart-safe manual check, command/help consistency 같은 bot reliability 개선
- course authoring guide와 validation checklist. Source: `docs/kanban.md`
- per-beatmap freemod course field. Source: `docs/kanban.md`
- map/course별 multiple pass conditions. Source: `docs/kanban.md`
- map 사이 target player가 rest를 건너뛰는 `!ready` command. Source: `docs/kanban.md`

## Phase 3: Judgment and Proof Policy

- explicit score-interpretation layer를 통한 multi-ruleset과 lazer accuracy support. Source: `docs/kanban.md`
- normalized score stats 뒤의 mode-specific judgment counters. Source: `docs/kanban.md`
- replay file 또는 handcam video를 staff proof review에 포함할지 결정. Source: `docs/kanban.md`
- normal/gold pass 같은 pass grade 정책. Source: `docs/kanban.md`

## Phase 4: Product Expansion

- 구현 전 lazer/API v2 room-control research
- dan catalog search
- admin auth account와 운영 도구
- difficulty와 skillset voting
- hosting, verification URL, abuse handling, proof semantics가 정의된 뒤 dynamic profile banner generation
- auth, ownership, moderation, validation, persistence decision이 명확해진 뒤 custom course creation UI

## Not Current Direction

- pacemaker overlay
- generic real-time leaderboard surface
- 현재 product contract 밖의 write UI
- 구현 전 정책이 정해지지 않은 replay-upload proof flow
