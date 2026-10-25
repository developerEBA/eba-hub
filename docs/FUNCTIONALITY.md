# EBA Hub functionality checklist

This record supersedes earlier demo-dashboard completion notes. A UI or compiled code path alone does not count as an end-to-end working feature.

## Fully implemented and tested locally

- Zod input validation, WAT date conversion, Lagos due-date filters and Google Meet URL allow-listing.
- Core migrations 001–005 execute in test-only PGlite PostgreSQL.
- SQL task creation/edit/completion, rereading through another authenticated query, database count/progress changes, and rejection of nonmember writes.
- SQL project creation/update, role checks and participant removal constraints.
- SQL private message persistence/read by a second identity, outsider denial and sender impersonation denial.
- SQL independent single-decision approvals, leave-request atomicity and recipient-scoped notifications.
- SQL focus/profile updates and denial of client role escalation.
- SQL reminder idempotency and rejection of employee access to the delivery runner.
- SQL meeting record/invitation storage without fabricating Google Meet URLs.
- SQL inactive-employee denial across tasks/messages/notifications.
- SQL nominations and management-approved recognition, including self-nomination and direct-publish denial.

These are SQL/validation results using simulated `auth.uid()` values inside an actual embedded PostgreSQL engine. They do not demonstrate a real Supabase signed-in session or browser refresh.

## Implemented but not yet tested end-to-end

- Google OAuth start/callback, active-employee membership gate and sign-out.
- Projects/tasks forms, persisted completion checkboxes, deadlines, priorities, participants and RLS-scoped dashboard statistics/progress.
- Private chats/channels, persisted messages, Realtime subscription refresh, emoji stickers, file attachment registration, voice recording/upload/playback.
- Internal meeting creation/update and attendee management. This stores internal records/in-app invitations, not Google Calendar events.
- Leave/general approval forms, transactional review and recognition nomination workflows.
- Focus, profile display-name settings, announcement publication, notification read state and role-scoped counts/report view.
- Authenticated record search across tasks, projects, people, messages and files.
- Private Storage upload metadata verification and signed download/audio URLs.
- Supabase-specific migration 006 (Storage policies and Realtime publication).

All mutations check identity, active employee membership, validation and database errors. Database RLS/RPC privileges are authoritative. No browser-only permission check grants a write.

## External credentials or configuration required

- An approved isolated Supabase project, URL, publishable key, applied migrations, active test profiles/departments/memberships and short-lived test user JWTs.
- Approved Google OAuth provider credentials/configuration in Supabase; canonical APP_URL and redirect allow list.
- Real Supabase Storage and Realtime validation; two independent signed-in browser sessions.
- pg_cron activation and recurring-run observation for the durable reminder runner. No paid service is needed for the prepared in-database runner; availability must be confirmed in the chosen project.
- Scoped Google Calendar/Meet and Workspace credentials **plus adapter implementation**; credentials alone do not make those integrations operational.

## Not yet implemented

- Google Calendar event/Meet-link generation, external invitation sending and Google Workspace employee account provisioning.
- Automated performance scoring, client/campaign business workflows, client analytics and monthly management reporting. The dashboard displays required-setup/unavailable states instead of fictional scores.
- Admin employee/role provisioning UI; trusted operator SQL setup remains necessary.
- Custom uploaded sticker library, full conversation management/history pagination, file scanning/retention and comprehensive knowledge-document lifecycle.
- Email/push delivery providers; reminders currently target in-app notifications.
- Full Google SSO/browser logout validation, refresh persistence and cross-browser Realtime/Storage verification until credentials are provided.

## Test results

Final executed command/browser outcomes are appended below. Live Supabase integration is explicitly opt-in and skips without isolated-project confirmation and credentials. A skipped test is not a successful verification.

## Executed verification — final result

- TypeScript: passed (`tsc --noEmit` using bundled Node 24).
- ESLint: passed (`eslint .` using bundled Node 24).
- Production build: passed (`npm run build`), including Next.js TypeScript and page generation.
- Unit/PostgreSQL tests: **25 passed, 0 failed, 1 skipped**. The skipped test is the genuine Supabase integration suite because no isolated-project credentials/confirmation are configured.
- The PostgreSQL fixture is disk-backed; records were verified after database close/reopen. Its temporary directory is checked to remain under the OS temporary root with the task-specific prefix before cleanup. This is test infrastructure, not a substitute application database.
- Additional database fault tests verified private attachment metadata visibility, rejection of unshared attachment references, management self-approval denial, nomination self-review denial, retry tracking and the five-attempt failure state.
- HTTP smoke: all 18 workspace routes (including leave) and login returned 200 in explicitly enabled setup mode. No route rendered the former sample profile. Search and OAuth callback returned explicit 503 setup errors without credentials.
- Production fail-closed check: with `EBA_SETUP_PREVIEW=false`, `/dashboard` returned 307 to `/login`.
- Playwright-backed browser checks: task quick action navigated to its correct route; setup mode exposed no task write form; record search displayed its real setup error; the profile disclosure opened; nine dashboard sections remained present; all six counts were unavailable (`—`), with no fake employee.
- At 1536×1024, the production setup dashboard document measured exactly 1536×1024 with no page overflow. Geometry evidence is `docs/screenshots/setup-checks.json`.
- The initial production setup dashboard was visually inspected through a browser screenshot. Saving the later final screenshot failed because browser capture became unavailable, including on a fresh tab. No new final screenshot file is claimed. Earlier screenshot artifacts show the previous sample presentation and are historical only.
- The local verification servers were stopped after testing. No live Supabase migration, production write, provider operation or deployment occurred.

No outstanding TypeScript, lint, build or executed-test failures remain. The test runner retains the existing harmless module-type inference warning. The default terminal remains Node 20; use a supported runtime before development.

## Immediate next step

Configure and approve an isolated Supabase project in `.env.local`, review/apply migrations 001–006, create active test profiles/departments/memberships, enable the approved Google OAuth provider and callbacks, then run the opt-in Supabase suite and browser flows with two real sessions. Only after those pass can the implemented application slices be labeled working end-to-end. Provider adapters and the explicitly unimplemented workflows above still require development.

The final SQL regression test also verifies that saving unchanged reminder fields does not re-arm an already delivered job. All 25 local tests passed after that correction. No application TypeScript/CSS change followed the successful production build; this final correction was confined to the unapplied SQL migration and its test.

