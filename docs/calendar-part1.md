# Calendar Part 1

Part 3 is now implemented in `docs/calendar-part3.md`. Its forward migration
replaces the historical reminder preparation described below with durable private
in-app stages and schedule revisions. Apply migrations in order.

The application code is ready for a manually applied migration. No hosted schema changes, account creation, dependency installation, Google requests or reminder delivery were performed during implementation.

## Apply in this order

1. Back up the target database and confirm it is the intended EBA Hub project.
2. Run the **read-only** `supabase/checks/calendar_part1_preflight.sql` in the SQL Editor. It works both before and after this migration.
3. Apply **`supabase/migrations/20261116115940_calendar_part1.sql`**. Do not apply it twice; it intentionally fails on duplicate objects rather than altering an unrelated table.
4. Run the preflight again. All five new tables must have RLS enabled. Authenticated users may SELECT metadata but must have no INSERT, UPDATE or DELETE grants. Requests and reminders must not be browser-readable. Only `calendar_access` is executable by authenticated users; `calendar_mutate` is service-role-only.
5. Restart the app, then run the post-migration verification below.

Prerequisites: the existing `staff_memberships` and `connect_profiles` migrations; active `ceo`/`admin` memberships; staff authentication with verified `@enibrand.com` accounts; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Existing application dependencies suffice. No Google credentials are required for Part 1.

The Supabase CLI was not present in the workspace, and no CLI/dependencies were installed. The timestamped SQL is supplied directly for manual application. Hosted schema inspection was unavailable; existing local schema and migration files were used to review the staff table and department assignment model. Existing department plans and Connect channel labels are not treated as staff assignments.

## Behavior and boundaries

- This Week and Next Week run Monday–Sunday in **Africa/Lagos**. Upcoming includes ongoing and future scheduled occurrences, sorted by start, with the first 200 shown. All datetime inputs and defaults are Lagos time, independent of the browser's timezone; database timestamps are UTC instants.
- Meetings require a 1–160 character title, optional agenda up to 4,000 characters, a future start, an end within 24 hours after it, and 1–100 other active CEO/Admin attendees. The organizer is implicit.
- Weekly recurrence has an inclusive end date, at most 364 days after the first date (up to 53 weekly occurrences including both endpoints). Recurrence type is set at creation; create a new series to change a one-off into weekly or vice versa.
- Each occurrence has a stable UUID, ordinal, original start, current start/end, attendee snapshot and version. A single-occurrence edit can move it beyond the original series dates without changing the series.
- Editing the remaining weekly series uses the selected occurrence as its anchor and applies the new cadence/title/agenda/attendees through the supplied end date. Extending creates dates; shortening tombstones surplus dates. Explicit single cancellations and a cancelled remainder never revive. Earlier occurrences and ended dates remain unchanged.
- Only the organizer may edit/cancel scheduled occurrences that have not ended. Attendees have read-only details. Cancelled dates leave upcoming lists but remain stored. Updates use optimistic version checks and request IDs; retrying the same request is safe. Reusing its ID with different content is rejected.
- Staff status is checked on every HTTP request. List/detail handlers repeat the organizer/invitee filter, and occurrence RLS independently enforces the same visibility. Series metadata is organizer-only. Browser writes and mutation RPC execution are revoked; the server-only transaction rechecks active membership, organizer identity, version, active invitees and assigned departments atomically. Never expose the service key in `NEXT_PUBLIC_*` variables.
- Calendar and Overview use the same occurrence query. Visible calendars and Overview refresh every 15 seconds and on focus; Refresh is available immediately. This is polling, not a Google or realtime integration.

## Departments

The migration creates an **empty** `staff_department_assignments` table, keyed by actual staff membership and one of the existing department identifiers (`graphics`, `development`, `communications`, `events`, `marketing`). Do not seed employees or infer assignments from plan owner text, roles or chat memberships.

Populate it only with real assignments through an authorized administrative workflow/SQL. Calendar options derive from assignments joined to active CEO/Admin memberships, so an unassigned department is absent. Selecting a department expands its current eligible members when the transaction saves. The selected department codes and resulting individual attendees are snapshotted on each occurrence; later assignment changes do not silently add recipients to old meetings.

## Google and reminders (Part 2 preparation)

**Part 2 update:** Google event creation, Meet preparation and recording
configuration are now implemented separately; see `docs/calendar-part2.md` for
the forward migration, worker deployment and live test/cleanup steps. The
paragraphs below describe the Part 1 boundary. With Part 2 applied, pending
meetings remain pending until their own Google conference succeeds; a connected
organizer alone still does not make a meeting ready. Existing live tests now
require explicit `EBA_TEST_ALLOW_GOOGLE_EVENTS=yes` because a deployed worker can
process their queued test meetings. Never hard-delete pending Google cancellations.

Organizer authorization is now implemented separately under Settings; see
`docs/google-organizer-authorization.md`. A connected organizer and supported
primary-calendar conferencing do not create a Meet conference or make any meeting
ready. Calendar retains **Meet setup pending** until actual per-occurrence Google
Meet creation is implemented and succeeds. The authorization migration does not
modify Calendar provider fields, occurrence statuses or reminder records; future
Google event synchronization must reuse the provider fields described below.

The Calendar UI deliberately says **“Meet setup pending”**. Calendar makes no Google API call and generates no fake Meet URL. Settings authorization performs its own identity, token and read-only calendar-capability checks. Series and occurrences have provider/calendar/event IDs; occurrences also have join URL, ETag, synchronization status/error and last-synced time. Provider event identity has a partial unique index.

Reminders reference an **individual occurrence ID**, recipient and occurrence version, with a unique lead-time/channel combination. Part 1 creates no reminder jobs. Any occurrence change invalidates unsent reminder records; timing/attendee changes become `needs_reschedule` with no scheduled time, cancellation/removal becomes `cancelled`. Sent records remain historical. The Part 2 worker must re-read occurrence status, eligibility and version immediately before dispatch, including after claiming a job, to avoid stale deliveries. Sync should likewise use occurrence versions and stable IDs to reconcile updates/cancellations.

## Verification

Dependency-free local tests, lint, types and production compilation:

```powershell
npm run test:calendar
npm run lint
npx tsc --noEmit
npm run build
```

If the local Turbopack worker fails to start, `npm run build -- --webpack` verifies the production build through Next's supported alternate bundler. This does not change the default build configuration.

The local suite tests Lagos dates, week/year boundaries, recurrence bounds and durations, invalid payloads, and the real HTTP handlers with an isolated repository. Isolated browser tests exercise actual React components with test fixtures; they are not evidence of deployed RLS or live account synchronization.

### Database integration test after migration

Run **`supabase/checks/calendar_part1_verification.sql`** as postgres in an isolated test database. This is a write-based test enclosed in a transaction that ends with `ROLLBACK`, distinct from the read-only preflight. It requires existing active CEO/Admin test users:

- `eba-admin-test@enibrand.com` (Admin)
- `eba-ceo-test@enibrand.com` (CEO)
- `eba-calendar-uninvited-test@enibrand.com` (active CEO or Admin; intentionally not invited)

It checks Admin scheduling CEO, both authenticated RLS views, a third active account's denied detail access, denied invitee writes, server transaction ownership enforcement, single-date rescheduling, stable other dates, cancellation removal, remaining-series updates/cancellation, and reminder invalidation. It creates no auth users, memberships or department assignments.

### Manual browser/API/RLS acceptance after migration

Use three existing, disposable staging accounts: active Admin, active CEO and
an uninvited company account. Do not create production accounts or use live
calendar records. With the staging migration applied, have the Admin create a
uniquely titled meeting addressed to the CEO. Confirm both see it, the uninvited
account receives a 404 for the meeting detail and direct database reads deny
that account. Verify attendee changes are denied, reschedule and cancel the
meeting, and confirm Overview and Calendar agree. Repeat with a weekly series,
one-date cancellation and remaining-series update/cancellation. Record only
PASS/FAIL outcomes; this repository does not include an automated signed-in
browser runner.

## Implementation verification record

- Passed: seven local date/recurrence/validation/HTTP-contract tests, including the fallback for local browsers without `crypto.randomUUID`.
- Passed in isolated React browser fixtures: Admin schedules CEO; invitee sees read-only details; rescheduling is visible in both role views; cancellation removes the entry; outsider details return 404; weekly creation; one-date and remaining-series cancellation; remaining-series editing; empty department choices; 390px mobile layout and modal fit.
- Passed: full-project lint and TypeScript. Production compilation is verified with `npm run build -- --webpack`; default `npm run build` hit the existing Turbopack CSS worker startup failure, including outside the sandbox. The default configuration was not changed.
- Not run: the supplied post-migration SQL assertions or live-account acceptance. They require the manually applied schema and configured test accounts. No live RLS/SQL result is inferred from local checks.
