# Calendar Part 3: private in-app reminders

Parts 1 and 2 are preserved: Lagos views, organizer permissions, weekly occurrence
and remaining-series edits, cancellation, Overview, Google identity, leases and
retries. Google connection alone never makes a meeting ready. Recording eligibility
is unchanged. This milestone adds no push, email, SMS or recording retrieval.

## Operator setup

No dependency or new environment variable is required. Keep the existing server-only
worker secret, Supabase service credential, Google OAuth configuration and encryption
key. Do not expose these in public environment variables or browser code.

1. Run `supabase/calendar-part3-preflight.sql` read-only. Parts 1, Google organizer
   authorization and Part 2 must be installed. Check constraints, policies and each
   required **column** grant: BYPASSRLS does not imply auth.users SELECT privileges.
2. Apply `supabase/migrations/20261117010000_calendar_part3_private_reminders.sql`
   yourself after normal backup/review. It plans future stages, skips past ones and
   sends no alerts or Google requests. Grants include only the five auth identity/
   eligibility columns needed, membership columns, notification insert/select/update
   columns, and notification identity sequence usage. No password/session fields.
3. Run `supabase/calendar-part3-verification.sql` read-only. Confirm zero duplicate
   keys/obsolete scheduled jobs and no browser access to jobs or delivery RPC.
4. In separate terminals run `npm run dev` and `npm run calendar:worker`.
   **Starting the worker may create real Google events, invitations and private
   in-app reminders from queued work.** Ctrl+C stops it. Build/start never start it.

Production still needs an authenticated scheduler and deployed endpoint supporting
the existing 120-second runtime. The local worker waits 60 seconds after a complete
request; timing is approximate, and slow synchronization can miss a grace window.
Monitor `reminders.available` and aggregate counts. No scheduler was deployed here.

## Behavior and privacy

Three durable stages per occurrence: 60 minutes, 10 minutes and start. Stored instants
drive delivery; display uses Africa/Lagos. No opt-outs. Recipients are only the current
organizer and explicit attendees with active, verified, nondeleted, nonbanned company
CEO/Admin accounts. Role alone never subscribes anyone. Future HOD/Employee support
must update centralized eligibility and dashboard/RLS rollout together; it is not
enabled here.

Alerts store identifiers/stage only, never a copied title, agenda or Meet URL. The
bell reads current occurrence fields through participant RLS. Removed/inactive people
lose old-alert visibility. Schedule changes hide old-revision alerts. Cancelled
alerts say cancelled and offer no Join. Both calendar and bell Join links go through
a server route which rechecks active authentication, participation, scheduled status
and an exact HTTPS Meet URL before redirecting. A previously distributed external
Google URL cannot be revoked just by hiding an EBA button.

Legacy approvals, messages, mentions, unread counts, mark-read and realtime refresh
remain. Before migration the bell can fall back to its legacy query. Alerts are
stored for an authorized return visit, but **closed-browser delivery is not
guaranteed**. Browser timers do not deliver reminders.

Existing department rooms have shared access (`member_low IS NULL`); they are not
private groups backed by trustworthy membership. Individual reminders are enabled;
group delivery reports `pending_private_groups`. Nothing posts to General or those
rooms. No assignments/accounts/groups are fabricated. A future group adapter must
authorize every current member and separately deduplicate by group/occurrence/revision/
stage. A selected-person meeting must stay individual whenever a group member is
outside the invitation. No group posting/dedup path is enabled in this release.

## Reliability and recovery

The delivery RPC locks occurrences using `FOR UPDATE SKIP LOCKED`, then locks their
jobs. Fresh eligibility, notification insert and job completion happen in one
transaction. Unique keys cover occurrence/schedule revision/stage/recipient. A retry
cannot duplicate an alert; another worker skips a held occurrence. Rescheduling and
cancellation serialize against the same occurrence lock. If delivery commits first,
it represents the then-current schedule; if an edit commits first, obsolete jobs
cannot send. Account eligibility is checked at delivery; membership and participant
visibility are rechecked through RLS and authenticated routes on opening.

Time changes increment `reminder_revision`, independent of provider/business version,
cancel obsolete unsent jobs and plan new stages. Title/agenda/provider updates do not
restart stages. Cancellation suppresses unsent stages. Weekly occurrences are
independent. Removing an attendee invalidates their pending jobs on that occurrence.

Grace is **two minutes inclusive**. Recovery skips older stages and selects at most
the latest relevant due stage per occurrence/recipient. Short-notice creation and
migration backfill skip stages already past. No start alert is delivered beyond
grace. On later rendering old items use passive labels, e.g. “Start-time reminder”.

Two reminder batches surround the unchanged Google batch. Each has an 8-second
transport timeout, default 10 occurrences (hard cap 20), 1-second lock timeout and
3-second soft deadline checked between occurrences/recipients. Google keeps its
85-second work budget. Both types of failure are isolated and all work is awaited.
Transaction failure rolls back alerts and completion together. Logs contain validated
aggregate counts only, never meeting details, credentials, authorization or job data.

## Verification

Run `npm run test:calendar:reminders`, `npm run test:calendar:worker`,
`npm run test:calendar`, `npm run test:calendar:google`, `npm run test:google`,
`npm run test:rendering`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

Reminder tests inject time and mock transport/database responses while exercising
real scheduling, recovery, cycle, Join and bell code. They cover three stages,
short notice, grace expiry, most relevant recovery, failure isolation, cancelled/
missing links, outsider handler denial, legacy alerts and mark-read rendering.
SQL text assertions are contract checks, **not PostgreSQL execution evidence**.

Run `scripts/calendar-reminders-db-test.sql` yourself on a disposable/staging database
after migration, with workers paused. It uses two existing verified accounts and
rollback-only fixtures, creates no accounts, calls no Google, and tests all stages,
retry dedup, weekly isolation, revisions, cancellation and downtime via injected RPC
time. Never commit it or change system/production clocks. Its delivery calls can
inspect other due jobs too, so use staging rather than a busy live database.

For database concurrency on staging, lock a known test occurrence in session A:
`BEGIN; SELECT id FROM public.calendar_occurrences WHERE id='<test UUID>' FOR UPDATE;`.
As service_role in session B call `calendar_deliver_reminders(<due timestamp>,10)`;
that occurrence must receive zero alerts while locked. Reschedule/cancel in A and
commit, then retry B: old stages must stay unsent. Release locks and run two delivery
calls concurrently, then run the read-only duplicate query: zero duplicate keys.
The HTTP endpoint never accepts an injected clock.

## Exact two-account live acceptance

Use existing test Admin in browser A and CEO in browser B. These operator tests can
create real Google events/invitations. No live reminders were sent during implementation.

1. Apply migration/check grants. Admin schedules `DEV reminder acceptance`, inviting
   only CEO, at least **70 minutes** ahead in Lagos. Note its UUID/start T. Both see
   it in Calendar and Overview. Start dev and worker in separate terminals.
2. At T−60 minutes each receives exactly one private alert: title, Lagos time and
   hour timing. Open its protected detail. Join appears only after a valid link is
   ready. Mark one account's alert read; the other's unread state stays unchanged.
   Repeat at T−10 and T: three alerts each, no repeats on subsequent cycles.
3. Create another future meeting and move it 30 minutes later before its first
   stage. Both views update; old times send nothing, new times send once. Change
   title only: no repeat. Cancel: upcoming removes it, pending reminders stop,
   retained alerts say cancelled, and a copied internal Join URL denies access.
   Google event cancellation must still happen automatically.
4. Create a meeting five minutes ahead: no immediate hour/ten-minute alerts; only
   start is eligible. On staging with Google mocked/unready, a reminder opens its
   detail without Join. Pause delivery until more than two minutes past start:
   restart produces no stale starting-now alert.
5. Create three weekly occurrences; move/cancel one, then remaining series. Only
   affected occurrence schedules change. Check duplicate/obsolete counts, and that
   no title was posted in General/shared department rooms.
6. In a controlled window, deactivate the CEO via existing authorized account
   administration before a stage. No new alert; old detail/Join denied. Restore
   the original status. Verify ordinary message/approval notifications and both
   per-item/all mark-read. Cancel test series and let Google cancellations drain.

Two-account limit: Part 1 requires at least one attendee distinct from organizer,
so a meeting using only Admin/CEO necessarily invites both. An **active uninvited**
account or replacing/removing the sole attendee needs a third *existing* test account.
Do not fabricate one. When available, replace CEO with that invitee: CEO gets no
future alerts; old detail/Join returns 404 and direct alert SELECT hides the rows.
Mocked handler denial does not establish this pending live RLS result.

Implementation checks passed: 9 reminder, 7 local-worker, 8 Part 1 calendar,
24 Google synchronization, 16 organizer authorization and 4 rendering tests
(68 total). Lint, TypeScript and production build passed. Isolated Playwright
rendering of the actual server bell with fixture data opened correctly at 1280px
and 390px, with protected Join links, no horizontal overflow and no page errors.
Browser plugin was unavailable; existing Playwright MCP was used. This fixture
test does not verify a signed-in Supabase session or live delivery.

## Evidence boundary

No dependency installation, hosted migration, account creation, live worker start or
live reminder delivery was performed. The read-only empty-ID `calendar_google_people`
probe succeeded against the existing invoker's five auth columns. Direct SQL connector
access was unavailable; operator per-column checks remain required. Hosted migration,
SQL test execution, concurrent sessions, account removal and live authenticated
browser acceptance remain pending. Record those separately from mocked checks.
