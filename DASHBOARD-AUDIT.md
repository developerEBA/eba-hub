# CEO/Admin Dashboard Audit

Audit date: 2026-11-21. Scope is CEO/Admin only. Employee/HOD dashboards remain unreleased. Existing Zoho accounts were left alone; email integration and mailbox provisioning remain paused. No DNS changes, hosted migrations, live jobs, Google events, invitations, or calls were made.

## Feature status

| Feature | Implemented | Evidence | Status | Remaining action |
|---|---|---|---|---|
| CEO/Admin sign-in and session gate | Yes in source | `src/lib/staff-auth.ts`, `src/proxy.ts`, `src/app/dashboard/access.ts`; `npm run test:staff-access` (12 pass) | PASS (local tests) | Verify live Auth users, normalized sign-in, persistence, sign-out and route denial in disposable development accounts. |
| Server/API/DB permissions | Yes in source | Role checks, RLS migrations, security-definer RPCs; staff and calendar tests | PASS (source/contracts); live RLS NOT VERIFIED | Run the combined SQL diagnostic and user-scoped negative checks against a confirmed development project. |
| Overview, navigation, quick actions | Partial | `src/app/dashboard/page.tsx`, `navigation.tsx`; production build enumerates all routes | PARTIAL | Replace explicitly pending project/task tiles only when the features exist; add retry affordances to read failures; browser-test every destination. |
| Dashboard data / empty/error states | Partial | Overview uses Supabase queries and renders empty/unavailable text | PARTIAL | Database-backed counts are not live-verified; several errors require reload rather than an inline retry. |
| Responsive/accessibility/loading | Partial | Suspense loading components and semantic controls; isolated rendering tests | NOT VERIFIED live | Run signed-in CEO/Admin browser acceptance at desktop and mobile sizes, including keyboard paths. |
| Guided workspace helper | Read-only help links, bounded pending approvals and authorized upcoming meetings | `src/app/dashboard/assistant/*`; `npm run test:assistant` | PASS (local checks); live Supabase data NOT VERIFIED | Verify protected queries and dialog behavior with an active CEO/Admin account. |
| Department Plans | Read-only submitted plans by department and week/month/year | `src/app/dashboard/projects/page.tsx`; `20261106000100` and `...00200` migrations | PASS (source); DB state NOT VERIFIED | Confirm migration presence and attachment authorization in development; HOD authoring remains unreleased. |
| Approvals | Yes | `src/app/dashboard/approvals/*`; approval and leave-document migrations | PASS (source); persistence NOT VERIFIED live | Verify concurrent decisions, required leave documents, optional rejection reason and required change note in development. |
| Connect / chat | Yes for currently eligible active Hub members | `src/app/dashboard/connect/*`; migrations `...00500`–`...00800`; calendar/notification tests | PARTIAL | General/DM and media flows have isolated tests; live membership, private downloads and reconnect are NOT VERIFIED. Department channels are shared, not department-private. |
| Notifications | Bell and chat read state are separate in source | `src/app/dashboard/notifications/*`, Connect notification migrations | PASS (source/tests); live delivery NOT VERIFIED | Confirm new approval/message notifications and read-state behavior against development DB. No opt-out UI found. |
| Calendar / Lagos / recurrence | Yes in source | `src/app/dashboard/calendar/*`; `test:calendar`, `test:meeting-updates` | PASS (local tests); live Google NOT VERIFIED | Migrations, OAuth scopes, real Google sync, import owner mapping and event delivery need staging acceptance. |
| Calendar reminders / call closure | Durable queues and worker code present | `src/lib/calendar-reminders/*`, `src/lib/calendar-google/call-ending.ts`, `scripts/calendar-worker.mjs`; call/reminder/worker tests | PARTIAL | Configure and verify production scheduler and retries. Private department-group reminder delivery is explicitly pending. Hub Join closure is separate from confirmed Google termination; recording setting does not prove a recording exists. |
| Staff access | Directory, Admin invite links, assignments, status changes and audit code present | `src/app/dashboard/settings/staff/*`, `src/lib/staff-access/*`, `docs/staff-access.md`; 12 tests pass | PASS (local tests); DB acceptance NOT VERIFIED | Apply/verify forward migrations in development, test invite expiry/revocation/single use and Admin/CEO boundaries. Invitation flow creates a link; it does not send email. |
| Clients / portal | Directory, portal invitations/shares/messages and deletion cleanup code present | `src/app/dashboard/clients/*`; client migrations `...01100`–`...01600` | PARTIAL | Cross-client isolation, invite acceptance/expiry, private download and cleanup need development acceptance. No live data inspected. |
| Recognition | Evidence-based weekly nominations/reviews and Admin-only publishing | `src/app/dashboard/insights/*`; migrations `...00900`–`...01000` | PASS (source); DB acceptance NOT VERIFIED | Verify independent reviews and CEO publish denial in development. Monthly/yearly recognition, most-active statistics, and teamwork awards are NOT IMPLEMENTED. |
| Games | Sudoku, Ludo, Chess, Checkers, Tic-Tac-Toe and Trivia code present | `src/app/dashboard/games/*`, `GAMES-LOUNGE.md`; `node scripts/verify-games.cjs` (35 pass) | PASS (local rules tests); multiplayer NOT VERIFIED live | Verify rooms, invites, presence, reconnect, concurrent actions and Game Night against disposable users. Trivia answer secrecy has local coverage. |
| Announcements | No author/publish/audience/pop-up implementation found | Route/component search | NOT IMPLEMENTED | No announcement feed is shown in Overview; authoring, audience controls, dismissal and read state remain future work. |
| Employee/HOD dashboards | Not released | `getStaffRole` admits only active CEO/Admin; staff access docs state the rollout gate | PASS (scope gate) | Keep rollout blocked until separately accepted. |
| Zoho / email / DNS | Existing Zoho accounts retained; email/mailbox integration paused | Request scope; no email provisioning implementation in audited flow | PAUSED | No change requested. Do not configure Namecheap or DNS. |

## Verification completed

- `npm.cmd run lint` — PASS.
- `npx.cmd tsc --noEmit` — PASS.
- `npm.cmd run build` — PASS; production route compilation and Next.js TypeScript phase completed.
- Offline suites: `test:staff-access` (12), `test:calendar:calls` (18), `test:meeting-updates` (17), `test:calendar:import` (11), `test:calendar:reminders` (10), `test:calendar:worker` (7), `test:google` (17), `test:rendering` (4), `test:calendar` (8), `node scripts/verify-games.cjs` (35). Total: 139 passing assertions/tests, zero failures.
- These suites use mocked providers, isolated fixtures, static SQL contracts and local handlers. They do not prove hosted migration state, deployed RLS, live OAuth, browser-account behavior or production scheduling.
- `.env.local` contains the required environment variable names for Supabase, Google Calendar, worker secret and app origin. Values were not printed. `EBA_TEST_ALLOW_GOOGLE_EVENTS` is absent, so live Google event tests are not enabled. Presence alone does not prove values are valid or identify a safe development target.
- No hosted database/browser was contacted. Applied migration state is UNKNOWN. The project has local migration definitions including forward staff-access and meeting-closure migrations; use the diagnostic below to identify missing schema objects in a confirmed development project.
- Existing modified/untracked files were preserved. No dependencies were installed, no hosted migration applied, and no live worker run.

## Priorities

1. **Development DB readiness:** establish the intended development Supabase project, then run `supabase/checks/dashboard_readonly_diagnostic.sql` as a project administrator. Apply only reviewed forward migrations in development; do not infer hosted state from local files.
2. **Private department spaces:** implement membership-aware room authorization and private reminder delivery before describing department rooms/reminders as private.
3. **Production scheduler:** provision a secured external scheduler to call `/api/calendar/sync` at the documented cadence, monitor retries, and verify the worker without starting it against live jobs during this audit.
4. **CEO/Admin acceptance:** use disposable accounts and records to verify role boundaries, cross-client/chat/calendar privacy, approval races, invitations and Google lifecycle behavior.
5. **Unfinished product areas:** activity statistics remain unavailable until work tracking captures verified contributors and completion events. Employee/HOD rollout remains subject to its access gate.

## Exact offline commands

Run from the repository root:

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
npm.cmd run test:staff-access
npm.cmd run test:calendar:calls
npm.cmd run test:meeting-updates
npm.cmd run test:calendar:import
npm.cmd run test:calendar:reminders
npm.cmd run test:calendar:worker
npm.cmd run test:google
npm.cmd run test:rendering
npm.cmd run test:calendar
node scripts/verify-games.cjs
```

Do not run `test:calendar:live` or `test:calendar:google:live` as part of offline verification; their documented flows may create provider events and require explicit live-test setup.

## Combined database diagnostic

Run [dashboard_readonly_diagnostic.sql](supabase/checks/dashboard_readonly_diagnostic.sql) in SQL Editor only after confirming the selected project is the authorized development project. It runs in a read-only transaction, checks expected tables/RLS/private buckets, and emits named failures for missing objects. It does not read staff/client records, secrets or invitation links. `NOT IMPLEMENTED` for department-group privacy is an implementation finding, not a schema migration result.

## Manual acceptance checklist

Use a disposable development Supabase project, synthetic records, and separate CEO, Admin, inactive, Employee/HOD, and client browser profiles. Keep live production users and real client data out of the exercise.

1. Sign in/out as CEO and Admin; verify normalized email, session refresh, direct protected-route access, and denial after deactivation. Verify Employee/HOD and client identities cannot enter `/dashboard`.
2. Visit each sidebar route and overview action. Check counts against seeded records, empty states with no records, keyboard navigation, errors/retry, and 1280px/390px layouts.
3. Submit synthetic department plans for week/month/year; verify CEO/Admin reads, draft denial, and authorized-only attachment download.
4. Create approval fixtures including leave without a document. Verify the request is blocked, then approve/reject/request changes; race two reviewers and confirm one decision persists. Verify CEO/Admin role permissions.
5. In separate CEO/Admin/third-member sessions, test General, DM, pagination, reconnect, duplicate retry, voice preview/discard/send/playback, sticker/emoji/mention/edit/delete, photo/PDF captions and private media. Verify bell reads do not clear chat reads and vice versa. Do not test department privacy as passed: it is not implemented.
6. Schedule and edit/cancel disposable Lagos meetings, including recurrence scopes. This changes the development DB and Google Calendar if connected. Verify sync retries/import mapping/reminders, outsider detail/Join denial, Join cutoff, manual end and completed history. Do not use real calls or production Calendar. Recording confirmation checks configuration/status only.
7. Create a disposable staff invitation link (external side effect: creates Auth/access records); verify recipient binding, expiry, revocation, one use, assignment revision, deactivation/reactivation and audit. Do not send the link or email during audit.
8. Create synthetic client and portal invitation/share records (external side effect: development DB/Auth/storage writes); verify CEO read/Admin write, client acceptance/expiry/revocation, cross-client isolation, private files and archive/delete cleanup.
9. Submit evidence-backed recognition nominations and independent CEO/Admin reviews; test no-award and disagreement, then matching agreement and Admin publish. Confirm CEO cannot publish and Overview shows published results only.
10. Create private game rooms with disposable members; test invite/presence/reconnect/concurrent moves/rematch and Trivia answer secrecy. Schedule a development Game Night and verify audience access.
11. Confirm the helper avoids announcement dialogs and voice recording; do not fabricate activity to fill Overview.

## Next step

Run the combined read-only diagnostic against the confirmed development Supabase project and share its named PASS/FAIL results; that establishes which migrations and RLS policies still need development rollout.
