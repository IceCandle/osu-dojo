# 기여하기

프로젝트 변경은 PR로 진행합니다. 한 PR에는 한 가지 scoped task만 담고, carded work라면 Kanban card ID를 함께 적습니다.

## 규칙

- 작업 규칙은 `docs/conventions.md`를 따릅니다.
- 현재 작업과 백로그는 `docs/kanban.md`가 기준입니다.
- sub-card를 구현하는 PR은 sub-card ID와 parent `[EP-xx]`를 PR description에 함께 적습니다.
- handoff 전에는 `pnpm build && pnpm test`를 실행합니다. 실행하지 못했다면 PR notes에 이유를 적습니다.
- `.env`, `dojo.db`, log, API key, IRC password, credential은 커밋하지 않습니다.

## 첫 작업

`docs/kanban.md`의 낮은 우선순위 Backlog card에서 시작하거나, owner와 verifier가 명확한 card를 Next로 옮겨 달라고 요청합니다.

course data 작업이면 `data/courses/*.json`을 수정하기 전에 `docs/course-authoring.md`를 읽습니다.
