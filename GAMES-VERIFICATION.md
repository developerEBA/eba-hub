# Games Lounge verification — 12 November 2026

## Observed checks

| Check | Result |
| --- | --- |
| Actual rule modules (`node scripts/verify-games.cjs`) | 17 passed, 0 failed; 8 Chess checks skipped pending operator installation |
| TypeScript (`npx --no-install tsc --noEmit`) | Passed |
| ESLint (`npm run lint`) | Passed after removing temporary browser QA artifacts |
| Production (`npm run build`) | Passed with Turbopack; previous build issue did not reproduce |
| Live database preflight | Not verified. Direct read attempt did not connect; connected Supabase account returned no projects. No SQL was applied. |
| CEO/Admin live multiplayer | Pending operator migration and authentication in isolated contexts; not represented as tested |
| Unauthenticated Games API | Actual local `/dashboard/games/api` returned HTTP 401 with the active-Hub-account requirement |
| Four-player Ludo | Pending four disposable development accounts; instructions in GAMES-LOUNGE.md |

## Game status

| Game | Status | Evidence / remaining work |
| --- | --- | --- |
| Sudoku | Playable; existing production component preserved | Three existing puzzles validated; real component browser controls, keyboard/Delete, pad, reset cancellation, complete solution and next-puzzle confirmation passed. Browser account/storage key remains unchanged. Live CEO/Admin per-account reload remains an acceptance test. |
| Ludo | Pending live verification | Rule tests passed for 2–4 seats, six release, third-six forfeiture, unsafe capture, safe squares, private home lane, exact finish and win. Local board interaction passed with an explicitly deterministic test die. Real server RNG/room concurrency require applied SQL. |
| Checkers | Pending live verification | Rules passed for mandatory captures, same-piece multi-jumps, men/kings direction, crowning, no-move win and draw. Local component move selection/hints/turn update passed. Live room test pending. |
| Tic-Tac-Toe | Pending live verification | Eight lines, draw, turn/occupied/finished rejection and alternating rematch opener passed. Local browser winning sequence and completed-board lock passed. Live room/rematch consent pending. |
| Chess | Blocked on operator dependency; then pending live verification | Board, promotion control and runtime adapter implemented. `chess.js@1.4.0` not installed. Eight dedicated rule tests are intentionally skipped, not declared passed. Create Room remains unavailable while missing. |
| EBA Trivia | Pending live verification | Deadline, host controls, duplicate/late answer rejection, exact scores/ties and before-close response privacy passed in actual rule/projection tests. Local component answer dispatch and disabled-after-answer controls passed. Live SSE, scoring transactions and two-account privacy pending. |
| Game Night | Pending live verification | Local UI verified Admin-only scheduling controls, date/time/selection fields, Lagos conversion (16:00 UTC → 17:00 Lagos) and session-lobby link. No schedule was written. Overview uses the same real session query. |

## Local browser method and limits

Authenticated app navigation did not produce a usable signed-in view in the isolated browser check. To avoid modifying auth or applying a database, a temporary harness compiled the **actual** client components and CSS with the already-installed TypeScript/React. It rendered into an isolated document, with explicitly synthetic initial data, stubbed Next navigation, and no production server actions. The harness was removed after checking. This is component-level browser evidence, **not** an end-to-end deployment claim.

- Desktop lounge: 1440×1100, six illustrations/cards, honest pending gates, no overflow.
- Mobile lounge: 390×844, single-column cards, no horizontal overflow.
- Sudoku: actual 81-cell component, pad/keyboard/Delete, cancel preservation, full correct solution, completion and confirmed next puzzle.
- Tic-Tac-Toe: local sequence 0,3,1,4,2 → win; all nine cells disabled after completion.
- Checkers: b6→a5, two legal hints before move and turn change after move.
- Ludo: deterministic QA six, token one released to start, retained turn. Server RNG was not bypassed or changed; it was not exercised in this isolated preview.
- Trivia: actual answer controls emitted `{type:"answer",answer:2}`, then disabled all choices on the synthetic answered response. Scores/privacy are separately covered by server-rule tests, not this fixture callback.
- Game Night: CEO preview had no schedule controls; Admin preview exposed date/time/game fields. The synthetic session link targeted its own lobby and displayed Africa/Lagos time. No submission occurred.

Visual inspection compared card count, illustration separation, original dashboard navigation/background inheritance, green/gold palette, readable action labels, board sizing and mobile wrapping. The preview shell did not reproduce the authenticated galaxy canvas, live fonts, notifications or account controls; those remain live-page QA items. A temporary fixture locator used the wrong accessible name for a Trivia answer; it was corrected and that UI check then passed.

## Files by review stage

1. **Rules and preserved solo:** `catalog.ts`, `rules.ts`, `trivia-rules.ts`, `trivia-bank.ts`, `chess-server.ts`, `scripts/verify-games.cjs`. Existing `sudoku.tsx` and `puzzles.ts` were not edited.
2. **Database/access:** `supabase/migrations/20261112000000_games_lounge.sql`, `supabase/checks/games_lounge_preflight.sql`, `games/server.ts`, `games/api/route.ts`, `games/api/[id]/route.ts`, `games/events/route.ts`.
3. **Lounge and boards:** `games/page.tsx`, `lounge.tsx`, `room.tsx`, `boards.tsx`, `game-art.tsx`, `games.css`.
4. **Integration:** Overview Game Night card in `dashboard/page.tsx`, optional server dependency tracing in `next.config.ts`.
5. **Operator handoff:** `GAMES-LOUNGE.md` has exact dependency command, forward order, read-only checks, supported rules, all six browser scripts, Game Night, failure/race/privacy checks and four-player account requirements.

## Remaining release conditions

The user explicitly chose to apply dependencies/migration later. Before calling multiplayer live-ready:

1. Operator installs the pinned library and applies the reviewed migration after existing migrations, then runs the read-only preflight.
2. Confirm the existing server-only Supabase secret reaches the intended development project; confirm grants/RLS/publication results.
3. Rerun all 25 rules without skips, lint, TypeScript and production build after installation.
4. Run the documented CEO/Admin matches and direct authorization/duplicate/version-conflict tests. Run four-seat Ludo with four distinct development users.
5. Verify authenticated desktop/mobile fonts, background, notifications and actual realtime reconnection. Remove test accounts/rooms according to the development environment's cleanup policy.
