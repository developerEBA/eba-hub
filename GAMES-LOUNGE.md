# EBA Hub Games Lounge

## Delivery stages and current release gate

1. **Preservation and rules:** the existing Sudoku component and three puzzles are unchanged. Pure server-validated reducers cover Tic-Tac-Toe, English checkers, EBA quick Ludo and timed trivia. Original SVG game illustrations are in `game-art.tsx`.
2. **Authoritative multiplayer:** private states, RLS-protected lobby/roster/results, service-only mutation RPCs, authenticated HTTP/SSE, room version comparison and request IDs.
3. **Experience:** six cards, searchable-by-game real room list, invitation-only or open staff rooms, capacity controls, turn labels, rules, presence, retained results and unanimous rematches. No seeded production players or rooms.
4. **Game Night:** Admin scheduling, Lagos date/time conversion, selected games, associated rooms, session lobby, completion/cancellation, and the real Overview card.
5. **Release checks:** automated rules, lint, TypeScript and production build; followed by the live two-account/SQL checks below. No database migration or dependency installation is performed by the agent.

Multiplayer Create Room controls are unavailable until the tables and server configuration are available. Chess additionally requires its installed rules library. These checks are availability gates, **not a substitute for live acceptance tests**.

## Operator installation (user-owned)

Only one new runtime package is needed:

```powershell
cd C:\Users\HomePC\Desktop\EBA-HUB
npm install --save-exact chess.js@1.4.0
```

Purpose: legal chess moves, check/checkmate/stalemate, castling, en passant, promotion and draw detection. Official API: https://jhlywa.github.io/chess.js/. The adapter preserves PGN, rather than only FEN, so repetition detection survives refreshes. The operator's install updates `package.json` and `package-lock.json`; the agent has not installed or changed these files. Rebuild and restart after installation. `next.config.ts` externalizes/traces the optional server package for deployment; no chess code or private trivia bank belongs in the client bundle.

The server uses the existing `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY`; legacy `SUPABASE_SERVICE_ROLE_KEY` is a fallback. Never prefix a secret with `NEXT_PUBLIC_`, paste it into chat, or put it in browser code. This server credential is necessary because game validation runs in trusted server code and browser roles have no state-write privilege. Authenticated routes independently validate `getUser()`, staff email and active Hub membership before using it. The SQL mutation RPCs additionally recheck active membership. They do not assume direct SELECT permission on `auth.users`; email validation belongs to the trusted authenticated HTTP layer. Inviting an active membership never bypasses the invitee's own staff-email/access check when joining.

## Forward migration and order

Existing repository migration sequence ends at `20261106001600_client_message_inbox.sql`. Do not replay old migrations already recorded in your database. Apply any missing existing migrations in filename order, then:

1. `supabase/migrations/20261112000000_games_lounge.sql`
2. Run `supabase/checks/games_lounge_preflight.sql` again to inspect the resulting grants, policies and publication.

The new migration is transactional and creates seven separate social-game tables, two service-only mutation functions and a membership helper. It depends on `staff_memberships` and `connect_profiles`. No recognition, performance, client or authentication schema is modified. The Supabase CLI was unavailable in this workspace, so the forward SQL file was authored directly; nothing was applied remotely.

Run the **read-only** preflight in the SQL editor before applying the migration. Expected before application: prerequisites exist and new game objects are absent. Expected afterward:

- RLS enabled on all seven game tables.
- `anon` has no table access.
- `authenticated` can only SELECT visible room/session/roster/invite/result metadata; no INSERT/UPDATE/DELETE.
- `authenticated` cannot SELECT `game_states` or `game_requests` and cannot execute `games_lobby_command` or `games_commit`.
- Both mutation functions are SECURITY INVOKER and executable only by the server role (plus database owner).
- `game_rooms` is published to `supabase_realtime`. Private state/request tables are not published.
- If `supabase_realtime` does not exist, the migration intentionally skips publication. Configure that publication yourself before realtime acceptance; five-second room polling / ten-second lobby polling still recover state.

Use your normal migration runner/SQL editor. Do not run a reset, seed production sample rooms, change RLS to make errors disappear, or grant authenticated users access to private game state. Keep this migration as the review artifact.

## Supported game rules

Rules are shown inside every room and defined in `src/app/dashboard/games/catalog.ts`.

- **Sudoku:** original clues, keyboard controls, number pad, reset/new confirmations, completion checks and `eba-hub:sudoku:v1:<userId>` browser progress. Browser-local, not cross-device sync.
- **Ludo:** 2–4 seats; four tokens each; six releases a token; 52 shared squares then six private home steps; exact finish at progress 57. All four starts and four stars are safe. Multiple tokens may share a square; no blockades. Unsafe landings send all opposing tokens on that square to base. Six gets another turn; a third consecutive six forfeits the roll. No capture bonus. No legal move passes automatically (a six still retains its extra turn). First to bring all four home wins. Dice are `node:crypto.randomInt(1,7)` on the server, never client-provided. Seat colours use starts 13 squares apart; with two seats the starts are adjacent rather than opposite.
- **Chess:** standard chess without clocks; White first; four promotion choices; castling/en passant and self-check enforced by chess.js. Threefold repetition, fifty-move and insufficient-material draws are automatic in this lounge. First player alternates between rematches. This is a friendly automatic-draw convention rather than a tournament draw-claim interface.
- **Checkers:** English/American short-range checkers. Red first. Men move/capture forward diagonally; kings in either direction. Mandatory captures, freely choose a capture (not maximum capture), mandatory same-piece continuation, crowning ends the turn. No pieces/no moves loses. EBA adds an automatic draw at 80 plies without a capture or promotion. No threefold draw claims.
- **Tic-Tac-Toe:** X first; strict alternation; empty cells only; all eight lines and full-board draw. X's player alternates on rematch.
- **Trivia:** eight original general-knowledge questions (no invented company policies), 20 seconds each, one immutable answer, 100 points per correct answer, no speed bonus. Host starts and advances; any participant can close an expired question. Connected clients request closure automatically. If everyone disconnects, the deadline still rejects late answers; the first reconnecting participant closes/scores it. Answers and correct keys are not returned before closure; ties share first place. No external scheduler is required.

## Access, integrity and reconnect contract

- Current rollout remains CEO/Admin. Both the existing dashboard gate and SQL membership checks retain this. No new accounts or roles are enabled.
- Participant identity, seat, ownership and capacity do not depend on a role name. To enable future HOD/employee roles, explicitly review the `staff_memberships` constraint, existing `getStaffRole` return type/dashboard gate, `games_access`, both RPC membership predicates and eligible-invite query together. Do not enable only the UI or RLS helper.
- Open rooms are discoverable only to authorized Hub members. Invite rooms are visible only to host/invitees. A non-participant may see safe metadata/results but never the board/private question responses. Participants receive a sanitized state through the authenticated endpoint.
- Only the server key can write state. Every action authenticates the user, verifies membership/room access and active seat, then runs the relevant reducer. Game-state JSON from a browser is ignored. State/score/dice are never trusted from a client.
- Lobby RPC row locks and a partial unique active-seat index serialize joins. Waiting-room departures compact seats and transfer host to the lowest remaining seat. Joining after start is refused; refreshing/reconnecting as an existing player preserves the seat.
- Move RPCs lock the room and compare the caller's observed version. Two different simultaneous moves cannot both commit the same version. `(actor_id,request_id)` is unique. A network retry reuses the same request ID; the original committed action is recognized without another dice roll or score. Stale requests return 409/reload. Accepted moves and joins increment room version. Presence pings do not.
- A disconnected player keeps their seat and turn. A stale presence label means “away”, not forfeiture. No automatic turn skipping, offline dice rolls or inactivity timeout. A player may explicitly leave: an active game ends as an abandoned social match, with no award; results are retained. This is intentional rather than trying to reassign a colour mid-game. Resigning a two-player board game awards the opponent a win.
- Completed results remain in `game_results` by room and round, including player-name snapshots. Rematch votes are versioned and require every remaining seated participant. Fewer than two players or gapped seats after a departure require a new room. The previous round remains in history.
- Realtime uses the existing server-authenticated SSE pattern. Postgres Changes sends **only safe room metadata** subject to RLS; clients refetch authorized state. Polling, focus/online refresh and presence pings supplement reconnects. No raw private state or answer bank is subscribed to.
- No game result writes, trigger, foreign key, score calculation or UI ranking is connected to employee recognition/performance.

## Game Night operations

Admin opens “Plan Friday Game Night”, enters a future date and time in **Africa/Lagos (UTC+01:00)** and selects games. The date/time is sent with an explicit `+01:00` offset, stored as `timestamptz`, and displayed in Lagos time on Games and Overview. Any chosen day is accepted; Friday is the default session title, not a hard scheduling restriction.

Scheduling creates a real session. Create rooms from game cards and choose that session to associate them. Sudoku is solo and does not create a room. “Join Game Night” opens `?session=<id>`, filtering the real room list. Open/invited room permissions still apply. Admin can mark a session completed or cancelled; existing rooms/results remain accessible. The next scheduled session (or a session started within the past 12 hours) appears on Overview. No session yields exactly **“No Game Night scheduled”**. Query failure is shown separately, never falsely reported as no session.

## Verification commands

```powershell
node scripts/verify-games.cjs
npm run lint
npx --no-install tsc --noEmit
npm run build
```

The rules harness runs actual TypeScript source via the already-installed TypeScript compiler, makes no DB writes/downloads, and stubs only Next's `server-only` import marker. Before installing chess.js, its eight checks are explicitly SKIPPED. After installation all 25 checks must pass. The tests cover Sudoku validity/restoration, all Tic-Tac-Toe lines/draw/turns, Checkers compulsory/multiple captures/crowning/no-move wins/draws, Ludo RNG bounds/capture/safety/exact finish/third-six and Trivia deadline/scoring/response privacy. They are not proof that the forward SQL has run or that browser realtime works.

## Concrete browser acceptance tests (CEO and Admin)

Use two isolated browser profiles, both signed into the same disposable development Supabase project: CEO and Admin. Do not share staff cookies between contexts. Never use employee production data for game-rule fixtures. Open `/dashboard/games` in both.

1. **Lounge and rollout:** see six original illustrations; Sudoku Play works; multiplayer Create actions only appear after migration/server readiness; Chess stays unavailable until installed. Verify an unauthenticated context redirects to sign-in and direct API calls return 401. An inactive/staff-only membership must not enter the lounge or subscribe to SSE. Inspect rooms with full/active/finished statuses and actual player names.
2. **Sudoku:** CEO selects an editable cell and enters a value through the pad, then with keyboard/arrow/Delete. Refresh: the value persists. Admin has independent progress. Fixed clues cannot change. Check incomplete/incorrect/completed boards; restart/new-puzzle Cancel preserves progress and Confirm resets it. Repeat at 390px width.
3. **Tic-Tac-Toe:** CEO creates, Admin joins, CEO starts. Play X0, O3, X1, O4, X2: X wins. Attempt occupied and out-of-turn actions with both UI and direct POST; server rejects. Both request rematch: round increments, result remains in history, X swaps players. Play squares 0,1,2,4,3,5,7,6,8: draw. Refresh both browsers mid-match and finish normally.
4. **Checkers:** create/join/start. Select a man, confirm legal destinations; illegal backward move fails. In a controlled dev match create a compulsory jump, verify non-capture is rejected and the same piece must continue. Reach the last row: king appears and turn ends. Verify king backward capture and win with no opponent moves/pieces. Use the deterministic rule tests for exact forced board arrangements; never mutate production state to manufacture positions.
5. **Chess:** after operator install/restart, create/join/start. Verify a blocked move and leaving own king in check are rejected. Play `f2-f3 e7-e5 g2-g4 d8-h4` for checkmate. Rematch and verify castling after clearing the path, `e2-e4 e7-e6 e4-e5 d7-d5 e5-d6` for en passant, and promotion selection. The scripted tests exercise stalemate/underpromotion/repetition/fifty-move positions reproducibly. Confirm PGN history survives browser refresh.
6. **Ludo:** create a four-seat room, join CEO/Admin, optionally start with two; roll only on the active seat. Browser requests carry no die value. On a six release a token; capture on unsafe squares and verify safe stars. Repeated sixes, exact home finishing and all-four-home wins have deterministic rule coverage. For four-player live acceptance use the disposable membership instructions below; a fifth simultaneous join must fail. Refresh after rolling: the same pending die remains. Leaving active play ends the room for all.
7. **Trivia:** host starts. Both see the same question/deadline. Inspect GET/SSE/network before closure: no `correct` property or other-player answers. Answer once; a second answer fails. Change local clock / send a late POST: server deadline still wins. After 20 seconds closure reveals the correct answer and adds exactly 100 for correct answers. Only the host advances; refresh/reconnect cannot reset time. Finish eight questions, verify total/ties/results/rematch.
8. **Game Night:** Admin schedules a future Lagos time with Sudoku + Tic-Tac-Toe + Trivia. CEO must not have scheduling controls, and a direct schedule POST as CEO returns 403. Create rooms linked to the session; Games and Overview show the same actual date/title. Join Game Night opens its lobby; unrelated rooms are filtered out. Mark completed/cancelled and verify the next real session or “No Game Night scheduled”.
9. **Concurrency:** open two tabs for the same player, issue moves with one identical version; at most one distinct move wins. Replay the same request ID: no extra move/die/score. Race CEO/Admin for the final seat: one joins, the other sees full. Refresh on 409. Stop network while a move is sent, reconnect and retry the *same* request through Retry previous request; state changes at most once. Disconnect during a turn, wait over 45 seconds, verify away label, reconnect and preserve turn. Explicit leave prevents further moves and preserves the completed/abandoned result.
10. **Permissions/privacy:** uninvited CEO cannot GET an Admin invite-room until invited. Invited staff see it in their own lounge; share the room link after inviting. Direct authenticated Data API INSERT/UPDATE/DELETE on every game table and RPC invocation of commit/lobby must fail. Direct SELECT private state/request and realtime subscription to them must fail. Deactivate a development membership mid-session and verify API/SSE reconnection stops allowing access.

## Four-player Ludo development accounts

The existing rollout only allows CEO/Admin, so four real seats require **four distinct active auth users** in a development project. Keep existing disposable CEO/Admin and create two additional disposable accounts such as `games-ludo-3@enibrand.com` and `games-ludo-4@enibrand.com`, each with an **active Admin membership** (the existing schema permits multiple Admins). Use four isolated profiles. These are explicitly development-only accounts; do not add production employees, invent HOD membership strings unsupported by the schema, broaden `getStaffRole`, or provision the users in this migration. The operator owns creation, passwords and cleanup. Remove/revoke their sessions and memberships after the exercise.

## Current verification limits

See the final task report for observed command/browser outcomes. Dependency installation, migration application, server-credential connectivity and live CEO/Admin/four-seat acceptance are operator-dependent. A passing production build alone does not certify multiplayer. No automated test creates or alters user accounts or applies SQL.
