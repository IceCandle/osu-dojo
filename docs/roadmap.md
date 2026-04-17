# Roadmap

이 문서는 프로젝트의 전체적인 방향을 잡습니다. 현재 제품 범위는 `docs/product-contract.md`, queued work는 GitHub Issues를 기준으로 봅니다.

## Vision

osu!dojo의 주 기능은 자동으로 진행되는 단위인정 로비 flow입니다. 플레이어가 course를 요청하면 봇이 멀티방을 만들고 운영하며, 사이트가 결과를 기록합니다.

## Phase 1: Current Shipped Scope

- Bancho IRC 기반 자동 단위인정 방
- 스테이블 std 멀티 점수 수집 및 판정
- `/`, `/dan`, `/dan/[systemNameKey]?course=<courseNameKey>`의 읽기 전용 코스/결과 카탈로그

## Phase 2: Near-Term Hardening

- Bot reliability와 운영자 확인 흐름 강화
- Course authoring과 course data flexibility 개선
- 로비 진행 중 player control surface 정리

## Phase 3: Judgment and Proof Policy

- 점수 해석과 mode-specific judgment boundary 정리
- 상위 단 proof review 정책 결정
- pass grade와 기록 의미 정의

## Phase 4: Product Expansion

- API/lazer 기반 확장 가능성 조사
- Catalog discovery와 운영 도구 확장
- Proof semantics가 정리된 뒤 public sharing surface 검토
- Auth, ownership, moderation이 정리된 뒤 user-generated course flow 검토

## Not Current Direction

- pacemaker overlay
- generic real-time leaderboard surface
- 현재 product contract 밖의 write UI
- 구현 전 정책이 정해지지 않은 replay-upload proof flow
