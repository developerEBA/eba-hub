# Calendar Part 2: Google events, Meet links and recording configuration

Occurrence Join now opens at scheduled start and closes three hours after end.
See `docs/meeting-join-windows.md` for its forward migration, optional Google
call-ending authorization, scheduler requirements and Google API limitations.

Google-owned primary-calendar import is now available as a separate forward
migration; see `docs/google-calendar-import.md`. Imported records remain managed
in Google and do not enter this outbound queue.

Part 3 adds private in-app reminder processing to this same endpoint and local
worker. Read `docs/calendar-part3.md` before running queued jobs: the worker can
now create private reminders as well as real Google events/invitations. Continue
running `npm run dev` and `npm run calendar:worker` in separate terminals.

Read `docs/calendar-part1.md` and `docs/google-organizer-authorization.md` first.
Part 1 remains the local source of truth: Lagos dates, recurrence, occurrence IDs,
organizer-only edits/cancellation, invitation visibility and Overview all remain.
Supabase username/password staff login and the active CEO/Admin rollout are unchanged.
The operator reports that Google authorization is live-connected as
`admin@enibrand.com`, Business Standard is active and recording permission is enabled.
This implementation does not independently verify those live account conditions.

## Install and deploy

No dependencies were installed and no hosted migrations were applied.
The workspace already contains `google-auth-library` 10.5.x in package.json and
node_modules. No new application dependency is needed for Part 2. If restoring
an earlier installation, install the existing manifest with your normal workflow;
the Google authorization guide documents `npm install google-auth-library@^10.5.0`.

1. Confirm Calendar Part 1 and Google authorization migrations are applied. Use
   the correct project; back it up through your normal database process.
2. Run **`supabase/checks/calendar_part2_preflight.sql`** as postgres in the SQL
   editor. This is read-only, ends in ROLLBACK, and selects no credentials, email
   addresses, Google identifiers, joining URLs or job payloads. Check both base
   tables, authorization storage and `server_can_resolve_real_emails`. Review any
   pre-existing unsupported join URLs before rollout. Part 2 tables/columns should
   be absent before first application; investigate existing objects before rerunning.
3. Apply only **`supabase/migrations/20261116210000_calendar_part2_google_sync.sql`**
   through your normal forward-migration process. It is not idempotent and must not
   be applied twice. Do not accidentally apply other pending migrations.
4. Re-run the preflight. The sync queue must have RLS enabled with **no browser
   grants or policies**. Private occurrence/provider columns and both new worker
   RPCs must be inaccessible to authenticated/anon roles. Occurrence visibility
   still uses Part 1's organizer/invitee RLS. Browser SELECT is now column-limited;
   use explicit safe columns rather than `select('*')`. `join_url`, `sync_status`,
   `recording_status` and an allowlisted error code are safe display fields.
5. Restart/deploy the app, then configure the worker below. Applying the migration
   makes no Google call. It queues existing unfinished scheduled occurrences and
   existing provider cancellations. **Starting the worker will process those
   existing meetings and can send real invitations**; review them first. Existing
   private provider IDs are retained, not regenerated. Foreign/unmarked legacy
   Google events are rejected rather than adopted or overwritten automatically.

The existing encrypted refresh-token key and server-only Google credentials remain
in use. Do not regenerate the encryption key just for Part 2. No Google identity,
event/space management or credential code is moved into client components.

## Required worker deployment

No reusable scheduler/queue consumer was found in the project. Part 2 supplies a
transactional database queue and **`/api/calendar/sync`**, but does not silently
provision cron, run Google calls from a browser timer, or start work after an HTTP
response ends.

Configure **CALENDAR_SYNC_SECRET** in the server's secret manager and your scheduler.
Use at least 32 unpredictable characters (for example 32 random bytes encoded as
base64url). Keep it independent of the Google encryption key and never put it in
NEXT_PUBLIC variables, URLs, source control, logs or browser requests. `.env.example`
contains a placeholder that the endpoint refuses to accept as a real secret.
To generate directly into an ignored local file without printing it:

```powershell
@'
const fs = require("node:fs"), crypto = require("node:crypto");
const file = ".env.local";
const existing = fs.existsSync(file) ? fs.readFileSync(file,"utf8") : "";
if (/^[ \t]*CALENDAR_SYNC_SECRET[ \t]*=/m.test(existing)) throw Error("Worker secret already configured");
fs.appendFileSync(file,"\nCALENDAR_SYNC_SECRET="+crypto.randomBytes(32).toString("base64url")+"\n");
'@ | node
```

### Local development worker

An explicit local runner is available as **`npm run calendar:worker`**. No new
dependency or migration is needed for the runner; it uses Node's fetch and the
existing Next environment loader. It is not part of `build`, `start` or `dev` and
does not start itself when imported. The runner rejects production/test NODE_ENV
values and deployed Vercel environments. It has no remote URL override: its only
target is `POST http://localhost:3000/api/calendar/sync`.

Configure **CALENDAR_SYNC_SECRET** in the project's ignored `.env.local`, using
the setup above. The runner requires that file and uses `next dev` environment
precedence, including `.env.development.local` and existing shell variables when
present. Keep any overrides consistent between terminals; a stale shell override
can otherwise cause HTTP 403. Environment loader errors, file contents, tokens,
Authorization headers, meeting details and response/error bodies are never logged.
Restart both processes after changing the secret; the worker loads it once.

**Starting the worker can process every eligible queued meeting against the
connected Google account, create real events, send invitations/updates and cancel
events. Review the local database/queue and intended attendees first.** Local app
code can still point at a hosted database and the real organizer account. This
command is not a dry run or a test-account filter.

Run these in **separate terminals**, from the project root:

Terminal 1:

```powershell
npm run dev
```

Terminal 2 (only when you intend to process the queue):

```powershell
npm run calendar:worker
```

The worker sends its first request immediately. It awaits the complete response,
then waits about **60 seconds after completion** before the next request. One
worker process never overlaps its requests; a slow invocation therefore makes
the start-to-start interval longer than a minute. Use one worker terminal for
normal development. The existing database leases still protect against other
workers or manual retries running concurrently.

Each request has a **150-second timeout**, allowing transport overhead around the
endpoint's documented 120-second runtime. Connection failures, timeouts, invalid
responses and non-2xx statuses are reported concisely and retried after the same
60-second delay. Missing/invalid secrets fail at startup. Redirects are refused
so a redirect cannot forward the bearer credential elsewhere.

Successful output contains only HTTP status and numeric **processed/recorded**
counts. These count attempts/outcomes, not ready meetings or successful recordings.
All other response fields are discarded for logging. A 401/403 indicates that the
worker and server secret configuration should be checked, without displaying it.

Press **Ctrl+C in the worker terminal** to cancel its current request or waiting
timer and stop further requests. The development server in Terminal 1 stays up.
An invocation already accepted by the server may still finish; stopping the local
worker does not undo meetings, remote operations or their durable jobs. If a job
is interrupted, its existing lease/retry recovery rules still apply.

### Production scheduling is still required

The local runner is not a production service or deployment hook. Production still
requires the scheduler below and a deployed Node endpoint supporting its runtime.

Set up an external scheduler to call your deployed HTTPS
`/api/calendar/sync` **every minute** with an HTTP Authorization header containing
`Bearer <CALENDAR_SYNC_SECRET>`. POST is preferred; authenticated GET is supported
for cron services that only invoke GET. Configure the header through the
scheduler's secret store, not as a query parameter. A staff browser cookie never
authorizes this endpoint. No scheduler configuration is committed or enabled.

Run it in a Node server environment that supports a **120-second invocation**;
the route exports that duration and applies an 85-second work budget. Each provider
HTTP request has a 12-second timeout bounded by the remaining work budget. The
existing authentication library also has request timeouts. Process up to five
occurrences per invocation; increase invocation frequency/concurrency only after
measuring capacity and Google quota. Parallel invocations skip locked jobs and
each occurrence has a five-minute lease. A terminated worker is recoverable after
lease expiry. Set the scheduler timeout to at least 120 seconds, observe failures,
and alert on repeated HTTP 503s or growing blocked/failed queues. Overlapping runs
are supported. A weekly series can take several invocations to prepare fully.

Without a running local worker or configured production scheduler, new meetings
remain durably queued. The organizer
can open the meeting and click **Prepare now**, **Retry meeting setup**, **Retry
recording setup** or **Retry cancellation**. These authenticated, same-origin POSTs
process only that organizer's selected occurrence and await the work. Invitees,
other Admins and other CEOs cannot retry somebody else's meeting. A request timeout
does not lose the job; refresh and retry safely after an active lease has expired.
For a cancelled meeting, **View meeting status** in the save notice reopens its
tombstone; `/dashboard/calendar?meeting=<occurrence-id>` is also available to its
authorized participants. **Refresh meeting status** only reloads local status.

Useful private monitoring query (operator only, no sensitive payloads):

```sql
select state, error_code, count(*) as jobs, min(next_attempt_at) as oldest_due
from public.calendar_sync_jobs group by state,error_code order by state,error_code;
```

The worker response reports processed attempts and successfully recorded outcomes;
`recorded` is not a count of ready meetings. Inspect the public readiness fields
or private aggregate states to distinguish success, retry, blocked and failure.

## Mapping, idempotency and recovery

Every current Calendar meeting is online (Part 1 already presents Meet preparation
for all meetings). Saving commits the EBA occurrence and its queue record in the
same transaction **before any Google operation**. The HTTP save stays fast and
does not wait for Google. Part 2 itself added no targeted reminders or recording retrieval; private reminders are now covered by Part 3.

Part 1 materializes every weekly occurrence. Part 2 deliberately creates **one
single Google Calendar event per stable local occurrence**, not a Google RRULE
master. This avoids a competing recurrence engine and lets shortened/re-extended
series and moved exceptions retain Part 1's exact semantics. Google Calendar will
show individual events rather than one native recurring series.

- One-occurrence edits update only its event. Remaining-series edits queue every
  changed materialized row, preserving its ID. Extensions add events, shortening
  cancels surplus events. Explicit cancellations and cancelled remainders do not
  revive. Local occurrence and ordinal identities remain stable.
- Existing provider/calendar/event/ETag/join/sync fields are reused. Added fields
  store the conference identifier, immutable Meet space name and separate recording
  state. `calendar_series.provider_series_id` is unused because there is no Google
  recurring master. No duplicate meeting store is introduced.
- Google event IDs derive from the occurrence UUID using valid base32hex characters.
  The ID is reserved locally before I/O; its presence alone is **not** proof that
  Google accepted the event. A timed-out accepted insertion is recovered by GET
  and the same ID, never a new random event. A duplicate/409 is reconciled by GET.
- Each conference request has a stable ID per occurrence/generation. Pending
  requests are fetched later, never replaced with a new request ID. Only a
  definitive Google conference failure followed by an explicit organizer retry
  advances its conference generation. A recording retry does not recreate a
  usable conference or resend an unchanged event update.
- Lease/version checks precede writes, Google event updates/deletes use If-Match,
  and local results are committed only for the claimed occurrence version and
  current lease. 412s re-read on a later attempt. Google private properties bind
  events to the local occurrence, series, workspace and version; a foreign event
  or newer remote version is not overwritten.
- An edit during an in-flight Google write can briefly leave Google behind local
  state: the database and Google are not one distributed transaction. Its older
  result cannot label the newer local occurrence synced; the queued latest version
  converges afterward. Do not describe external synchronization as instantaneous.
- Cancellation never inserts an event. Tombstones are retained. If a create timed
  out and Google initially returns 404, cancellation reconciles for up to 24 hours
  to catch a late accepted insert. A confirmed delete/cancelled event finishes
  immediately. After exceptional provider delays beyond that window, inspect and
  retry cancellation manually; do not hard-delete its local identity first.
- Network/429/5xx and conditional-write conflicts use bounded exponential retries.
  Most failures stop automatic attempts after eight claims; an asynchronous pending
  conference gets up to twelve claims. Failed outcomes retain local records and
  expose an actionable organizer retry. Invalid permissions, account changes,
  unverified/inactive participants and revoked authorization pause the job.
  Reconnection wakes blocked authorization jobs. Google errors, tokens, private
  resource IDs and attendee email resolution remain server-only.

## Identity, invitations and privacy

The shared Google account is the provider organizer, not an EBA permission grant.
EBA creator ownership and participant visibility still gate every list, detail,
edit, cancellation and manual retry. A CEO can schedule/prepare their own meeting;
an Admin who is merely invited still cannot edit or retry it.

The worker resolves the creator and snapshotted attendees against **actual
auth.users**, verified staff email, current active CEO/Admin membership and account
status. It fabricates no names, addresses or department membership. If any required
participant is no longer eligible it pauses before creating/updating invitations;
the organizer must correct the selection. Cancellation can still remove the remote
event when participants have become inactive. Existing department expansion stays
inside Part 1's membership/assignment transaction.

Google guests are only these validated creator/attendee emails, with the Google
organizer itself excluded as a redundant guest. Calendar guest modification,
inviting others and seeing other guests are explicitly disabled. Google writes use
`sendUpdates=all` for intended guest invitations/updates/cancellations; they do not
post anything in EBA General or send the whole staff directory. An unchanged retry
skips the event PATCH. Google delivery and recipients' Calendar policies can still
affect notification delivery. Native Google account owners retain their provider
permissions; this app does not grant EBA-wide editing through that account.

## Meet readiness and automatic recording

The first event response can contain `conferenceData.createRequest.status=pending`.
The worker persists preparation state and schedules a later attempt. It shows a
Join link only after Google returns a valid HTTPS Meet video entry point whose
conference identifier matches the URL. Strict URL validation is repeated in the
database and UI. No URL is guessed from an occurrence ID or a connected account.

Once ready, the worker resolves the meeting code to the immutable Meet `spaces/*`
resource and uses **spaces.patch** with this precise update mask:

`config.artifactConfig.recordingConfig.autoRecordingGeneration`

The requested value is **ON**. It changes no access, moderation, transcription or
notes settings. Recording is marked **configured** only when Google's GET already
confirms ON or the PATCH response confirms ON for that space. Calendar readiness
and recording configuration remain independent: a recording error keeps the
usable Join link and displays a warning with retry.

The existing grants are sufficient: `openid`, `email`,
`https://www.googleapis.com/auth/calendar.events.owned`,
`https://www.googleapis.com/auth/calendar.calendars.readonly`, and
`https://www.googleapis.com/auth/meetings.space.settings`. No extra Drive,
recording-retrieval or broad Calendar scope is requested. Insufficient scope
requires an Admin to reconnect; a Workspace policy/API/eligibility denial may
require an administrator to correct the Google configuration first.

Google requires an eligible host/co-host to join on the web before automatic
recording starts. **The EBA creator is not automatically a Google co-host**: these
events belong to the connected Google organizer. Have that eligible organizer
join, or assign an eligible co-host through Google's supported controls. Business
Standard and an enabled recording policy do not guarantee recording. Users may
have consent prompts and Google host controls. The UI never claims that recording
is already running, unstoppable or guaranteed. No recording download/retrieval or
targeted reminder scheduling was included in Part 2; see Part 3 for private reminders.

Official documentation checked before implementation:

- [Event creation, IDs and guest permissions](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Asynchronous conference status and request IDs](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Conditional modifications and ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Resolve a Meet space and scope requirements](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/get)
- [Configure Calendar-created spaces](https://developers.google.com/workspace/meet/api/guides/meeting-spaces-configuration)
- [Meet space PATCH](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/patch)
- [Auto-recording configuration values](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces)
- [Recording eligibility and host/co-host requirements](https://support.google.com/meet/answer/9308681?hl=en)

## Verification

Run without creating live Google events:

```powershell
npm run test:calendar:worker
npm run test:calendar
npm run test:google
npm run test:calendar:google
npm run lint
npx tsc --noEmit
npm run build
```

The worker tests use a fake clock and injected HTTP transport, plus isolated
temporary environment files. They **never start the CLI against the app or POST
to localhost**. They check the immediate call, sequential completion including
response bodies, 60-second rescheduling, 150-second timeout, continued operation
after errors/non-2xx, safe count logging, clean cancellation, environment loading,
missing-secret errors and production refusal.

### Local automatic create/update/cancel acceptance test

This is a **user-triggered live test**, supplied for you to run; it has not been run.
It can create real Google events and send invitations.
Use a controlled development/staging database with the migrations applied,
Google connected and known active CEO/Admin test accounts. Review other queued
meetings before starting: the local worker processes the shared queue.

1. Start `npm run dev` in Terminal 1 and `npm run calendar:worker` in Terminal 2.
   Confirm the worker reports HTTP 200 with numeric counts. Leave it running.
   **Do not click Prepare now or manual retry during this test**; the purpose is
   to verify automatic processing by the local worker.
2. Sign in as the test Admin. Create a future one-off meeting in Africa/Lagos,
   titled `DEV Local Worker <unique suffix>`, inviting only the intended test CEO.
   Save and note the local meeting's deep link for cleanup. Both accounts should
   see it immediately as Preparing meeting. Within the next worker pass (up to
   about 60 seconds plus request time, longer with backlog/backoff), confirm that
   its actual Google event exists and Join Meeting appears in Calendar/Overview.
   Delayed Google conference creation may require additional passes. Verify the
   time and guests in the organizer's Google Calendar; exactly one event should
   exist. Recording configuration may complete separately or show an honest warning.
3. Edit the title/time as the EBA organizer. Wait for the next automatic pass.
   Confirm the same Google event is updated, with no duplicate event/conference,
   and both role views reflect the change. The invited CEO must remain unable
   to edit/cancel the Admin's meeting. Optionally repeat with CEO creating a
   separate test meeting inviting Admin to verify creator permissions both ways.
4. Cancel as its EBA organizer. It must disappear from both upcoming views
   immediately. Leave the worker running until Google Calendar confirms the
   event is cancelled/deleted. Open **View meeting status** or the saved deep
   link and use **Refresh meeting status** (read-only) to check cancellation.
   Do not mistake local cancellation for completed Google cancellation.
5. Leave the worker running through another idle pass and confirm no event is
   recreated. Once all test occurrences show cancelled and synced, follow the
   existing cleanup instructions below if removing local test series. Never
   hard-delete pending/failed cancellation records or their recoverable jobs.
6. Stop only the worker with Ctrl+C. Its terminal should report Stopped and issue
   no more requests, while the app remains usable. For a separate resilience
   check, stop the dev server briefly: the worker should report connection failures
   without exiting, then recover after the server restarts with the same secret.

Readiness is not a recording-start test: an eligible Google host/co-host still
must join under Google's requirements. No recording retrieval is included.

The sync tests use the real sync engine, provider transport contract, worker token
retry logic and HTTP handlers with mocked repositories/Google responses. Network
access is disabled by default in that suite. They cover duplicate prevention,
concurrent edits/claims, delayed conferences, partial recording failure, access
token expiry, revoked access, recurrence exceptions, repeated cancellations,
foreign-event protection, valid joining URLs and unauthorized retry/worker access.
They do **not** prove hosted locking/RLS, real OAuth scopes, Google notifications,
Meet availability or actual recording behavior.

After migration, run `supabase/checks/calendar_part2_verification.sql` in an **idle
staging database** as postgres. It needs the existing active
`eba-admin-test@enibrand.com` and `eba-ceo-test@enibrand.com` accounts. It exercises
the actual service-role queue/RPC, recurrence enqueue, single-use claim, stale
completion rejection, recording warning with preserved link, denied invitee retry
and remaining cancellation. It rolls back all writes and makes no Google calls.
For actual concurrency/lease recovery, run two worker invocations against staging
and check that one occurrence has only one active lease; also test a terminated
worker recovering after five minutes. These hosted checks were not run here.

### Explicit development test against Google

No live Google events were created during implementation. The following is a
manual staging acceptance action that can send invitations and configure
recording; it does not join a meeting or start/stop/download a recording. Use
the three existing `-test@enibrand.com` accounts. Keep credentials in a local
secret store and do not enable the worker unless staging jobs are intended.

During a specifically approved staging run, use the Calendar UI to verify the
actual Meet link, confirmed recording configuration, stable event identity on
retry/reschedule, weekly single/remaining edits, CEO organizer controls and
denied cross-owner retry. Also verify outsider privacy, Overview consistency and
cancellation in EBA and Google Calendar. If authorization is revoked or Google
is unavailable, preserve queued local records and restore the connection before
retrying cancellation. Do not bypass organizer checks. Event cancellation does
not end an active call or guarantee that a previously shared Meet URL stops
working.

### Exact manual CEO/Admin acceptance flow

1. **Admin → CEO:** Sign in as the active test Admin, schedule a future one-off
   meeting inviting only the test CEO, and save. Confirm it appears immediately
   in both EBA calendars as Preparing meeting. Run the deployed worker or click
   Prepare now. Both Calendar and Overview must show Join Meeting only after the
   link is available. Inspect the actual organizer's Google Calendar: exactly one
   event at the Lagos time, expected guests, and restricted guest permissions.
2. **Idempotency:** Retry preparation in two tabs and invoke the worker concurrently.
   Confirm exactly one Google event and one conference identity for the occurrence.
   Simulate a delayed conference in a staging mock: show Preparing, no Join; a later
   worker attempt completes the same request, not a replacement event.
3. **Reschedule and ownership:** Reschedule as its EBA organizer; confirm the same
   Google event updates and both role views/Overview reflect it. A stale concurrent
   edit must return 409. As the invited CEO, edit/cancel/retry must be denied.
   Create a separate meeting as CEO inviting Admin: CEO can prepare it, while the
   invited Admin cannot edit/cancel/retry it despite the shared Google account.
4. **Weekly exceptions:** Create three weekly occurrences. Move just the middle
   occurrence and confirm the other two Google events stay unchanged. Edit this
   and future occurrences from the middle: only the middle/last update. Cancel
   the middle alone, then the remaining series, and ensure retries do not recreate
   cancelled events. Preserve earlier event IDs and local occurrence UUIDs.
5. **Recording warning:** On staging, block/fail only the Meet settings PATCH on
   the server after event creation. The Join link must remain usable and the UI
   must warn about recording, not say configured. Restore access and retry:
   Google must confirm ON before the label changes. Join as the actual eligible
   Google organizer/host or assigned co-host to observe Google behavior manually;
   joining as an ordinary CEO guest alone does not establish host eligibility.
6. **Revocation and token expiry:** Let an access token expire or simulate a 401 in
   the mocked suite: the server refreshes once. For a controlled live test, revoke
   the app's Google access, then attempt a change: local data survives with
   Reconnect required. Reconnect as Admin and rerun preparation. Do this only after
   other test cleanup or reconnect before final cancellation cleanup.
7. **Privacy/cancellation:** An uninvited active account must receive 404 on detail
   and manual retry and no occurrence from RLS. Cancel as organizer, verify it
   disappears from both upcoming views immediately, then confirm deletion in
   Google Calendar. Retrying cancellation must not send a replacement invitation.
   Never post department details to EBA General or broaden the test attendee list.

Record live results separately. No live success is inferred from the operator's
existing connection, a build, a mocked test or an unexecuted SQL script.

## Implementation verification record

| Check | Evidence / limit |
| --- | --- |
| Local Calendar tests | 8 passed: Part 1 date/recurrence/contracts plus actual component rendering |
| Organizer authorization tests | 16 passed with mocked Google/Supabase, real encryption and handler code |
| Part 2 sync tests | 24 passed with mocked Google/database responses, including actual worker 401 retry and real retry/cron handlers |
| Local development worker tests | 6 passed using a fake HTTP transport/clock and temporary fixture .env.local files; no live jobs processed |
| Lint / TypeScript | Passed |
| Production build | `npm run build` passed with the existing installed dependency |
| UI fixture QA | Actual Calendar, meeting dialog and Overview components at 1280×900 and 390×844; pending hides Join, recording failure keeps Join, owner retry confirms configured, invitee has zero retry controls, Overview shows the same status, no horizontal overflow or browser console errors |
| UI fixture path | Isolated component fixture; not a signed-in hosted acceptance run. |
| UI review | Existing native controls reused. Review found only the existing meeting-dialog autofocus warning, retained as deliberate initial focus within a native modal. |
| Hosted SQL / live Google | Supplied, not executed. No live event was created and no recording was started. |

UI colors use EBA forest `#063C2D` and yellow `#FDE342`. Screenshots use fixture
meetings and example Meet links, not real meeting or recording evidence.
