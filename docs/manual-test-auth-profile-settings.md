# Manual test: auth, profile visibility, settings

Human QA checklist for the `web/auth-profile-settings` branch. Covers every
reasonable user action for osu! OAuth login/logout, `/settings` (visibility +
pinned clears), and the player profile changes that depend on them. Automated
coverage lives in `e2e/settings.spec.ts`, `e2e/auth.spec.ts`, and
`tests/settings.test.ts`; this list is for hands-on verification.

## Setup

Two ways to get a logged-in session locally:

- **Dummy auth (fastest, no osu! app needed).** In `.env` set
  `DOJO_E2E_AUTH=1`, `DOJO_SITE_URL=http://localhost:3000`, and a
  `SESSION_SECRET` of at least 32 bytes. Clicking Login skips osu! and returns
  you straight to the site as the seeded dummy user.
- **Real osu! OAuth.** Leave `DOJO_E2E_AUTH` unset and provide
  `OSU_OAUTH_CLIENT_ID` / `OSU_OAUTH_CLIENT_SECRET` (scope `public identify`)
  with the callback registered as `<DOJO_SITE_URL>/api/auth/osu/callback`.

Run with `pnpm dev` (or `E2E_USE_BUILD=1 pnpm build && pnpm start`). Use two
browsers/profiles — one **logged in as the owner**, one **anonymous** — to
check what each audience sees. Have at least one saved *pass* run for the owner
so the run picker and pinned clears are non-empty.

---

## 1. Authentication

- [ ] **Anonymous header** — logged out, the header shows an `osu!auth Login`
      button and no username/Logout control.
- [ ] **Start login** — click `osu!auth Login`; you are redirected to osu!
      (or, in dummy mode, straight back). After authorizing you land back on the
      page you started from and the header now shows your **username link** and a
      **Logout** button.
- [ ] **return_to from a deep page** — go to `/dan/<systemNameKey>`, log in from
      there, and confirm you return to that same page (not `/`).
- [ ] **Gated route redirect** — while logged out, open `/settings` directly.
      You are redirected to login, and after authorizing you land on `/settings`.
- [ ] **Session persists** — refresh the page and navigate around; you stay
      logged in (HttpOnly cookie).
- [ ] **Logout** — click `Logout`. Button shows "Signing out", then you land on
      `/` logged out with the `osu!auth Login` button back.
- [ ] **Server-side revocation** — log in, copy the session cookie, log out,
      then replay the old cookie (re-add it in devtools and refresh). The old
      session is rejected — you are treated as anonymous.
- [ ] **Cross-tab logout** — logged in in two tabs, log out in one; the other
      tab loses the session on its next navigation/action.

## 2. Settings — profile visibility (`/settings`, owner only)

- [ ] **Access control** — only reachable when logged in (see gated-route check
      above). Header shows your username and copy about managing details.
- [ ] **Default state** — the `프로필 상세 기록 공개` checkbox is **checked** by
      default (public).
- [ ] **Turn off** — uncheck it. A `role="status"` notice reads
      "공개 설정을 저장했습니다." and the box stays unchecked after refresh.
- [ ] **Turn back on** — re-check it; same success notice, persists on refresh.
- [ ] **Failure rollback** (optional) — with devtools offline, toggle it; the
      checkbox reverts to its previous value and the notice reads
      "공개 설정을 저장하지 못했습니다."

## 3. Settings — pinned clears (`/settings`, owner only)

- [ ] **Mode indicator** — the `대표 클리어` card shows the current mode
      (`auto` or `manual`).
- [ ] **Run picker lists passes** — "통과한 run에서 선택" lists your saved pass
      runs with system name and score/accuracy. With no passes it shows
      "저장된 pass run이 없습니다."
- [ ] **Load more** — if a `더 보기` button appears, click it and confirm more
      runs append without duplicates; it disappears when the list is exhausted.
- [ ] **Add a run** — click `추가`; the run moves into the selected list, mode
      flips to `manual`, and its picker button now reads `선택됨` (disabled).
- [ ] **Five-item cap** — add runs until 5 are selected; the remaining `추가`
      buttons become disabled (no 6th can be added).
- [ ] **Remove** — click `제거` on a selected run; it leaves the list and its
      picker `추가` button re-enables.
- [ ] **Reorder** — use `↑` / `↓` to move a selected run; order updates. `↑` is
      disabled on the first item and `↓` on the last.
- [ ] **Save manual** — click `수동 선택 저장`; notice reads
      "대표 클리어를 저장했습니다." and mode shows `manual`.
- [ ] **Save empty manual** — remove all selected runs and save; 0 pins is
      allowed and persists.
- [ ] **Back to automatic** — click `자동 선택 사용`; selection clears, mode
      shows `auto`, notice reads "자동 선택으로 돌아갔습니다."
- [ ] **Persistence** — refresh `/settings`; saved mode, selection, and order
      are restored.

## 4. Player profile (`/players/[userId]`)

Owner view (logged in, viewing your own profile):

- [ ] **Owner always sees details** — regardless of the visibility toggle, you
      see play count, pinned clears, recent runs, and most-played courses.
- [ ] **Pinned reflect settings** — pinned clears match your saved manual
      selection and order (or the auto picks in auto mode). Each shows
      course/system, score *or* accuracy, and completion time — and **no**
      leaderboard rank.

Other-viewer / anonymous view of the same profile:

- [ ] **Always public** — username, avatar (links to osu!), and highest official
      dan badge(s) are visible whether or not details are public.
- [ ] **Public details** — with visibility ON, an outside viewer sees play
      count, pinned clears, recent runs, and most-played courses.
- [ ] **Private details** — with visibility OFF, those sections are hidden and a
      "상세 기록 비공개" note is shown; the dan badge(s) still render.
- [ ] **Re-publish restores** — flip visibility back on; the outside viewer sees
      the previously saved details and pinned clears again.

Edge cases:

- [ ] **Non-numeric userId** — `/players/abc` returns 404.
- [ ] **Numeric, no saved runs** — `/players/<unused-id>` shows the empty state
      ("No saved runs"), not an error.
- [ ] **Mode tabs** — only the `osu` tab is active; `taiko`/`catch`/`mania` are
      disabled.

## 5. Visibility does NOT leak — adjacent surfaces

With the owner's profile set to **private**, confirm these still expose the
owner (visibility only hides profile *details*):

- [ ] **Player search** — the header search dialog / `/api/search?q=<username>`
      still returns the private user.
- [ ] **Course leaderboard** — `/dan/<systemNameKey>?course=<courseNameKey>`
      still shows the private user's run and rank unchanged (compare the
      leaderboard text before and after toggling visibility — it is identical).
