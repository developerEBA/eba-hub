# Occurrence joining windows and Google call ending

Join opens at the occurrence's scheduled start, including that instant, and
closes at scheduled end plus three hours, excluding that instant. Instants are
stored in UTC and displayed in Africa/Lagos. Calendar, Overview, bell meeting
notifications and the protected Join redirect use this rule. Browser controls
update each second and on focus; the server independently checks every redirect.
Cancelled occurrences and explicitly Admin-closed occurrences cannot join.
Each weekly occurrence has its own window; closing one never closes the series.
Upcoming retains overrunning occurrences through their grace period.

An active Admin who is the occurrence's existing Hub organizer/coordinator can
open its details and choose **End meeting for everyone…**, after the server checks
that its private provider identity belongs to the configured Google organizer.
Executive read access alone does not grant management of another person's meeting.
Foreign Google ownership makes the control unavailable.
Confirmation immediately closes EBA joining for that occurrence and queues a
separate Google termination request. CEO can join and view but cannot invoke this
Admin action. Organizer scheduling/edit/cancel rules and executive read access
remain unchanged. Cancellation is not a substitute for the termination action.
Manually closed occurrences stay closed if edited; the next occurrence is independent.

## What Google actually supports

Google documents `POST /v2/{name=spaces/*}:endActiveConference` with an empty body
and requires `https://www.googleapis.com/auth/meetings.space.created`. The scope
is sensitive and covers spaces created by the app. Existing Calendar-created
and imported Meet spaces are not guaranteed to qualify, even when the connected
account is their organizer. The existing settings scope alone does not authorize
ending a call. References rechecked November 19, 2026:

- https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/endActiveConference
- https://developers.google.com/workspace/meet/api/guides/authenticate-authorize
- https://developers.google.com/workspace/meet/api/guides/manage-meeting-spaces
- https://support.google.com/meet/answer/9303164?co=GENIE.Platform%3DDesktop&hl=en

This implementation preserves Calendar conference creation and does not replace
existing links or create test spaces. It cannot promise automatic termination for
every existing meeting. A 401/403 or missing permission produces an honest
unavailable state; use Google host controls to end for everyone in that case.
Disabling EBA joining does not revoke a previously shared Google URL. Ending the
observed conference does not permanently lock the space or prevent host restart.

The worker checks the owned Google event, matching link, canonical space and
active conference identity. It binds that identity before terminating and checks
again immediately before POST. Retries never intentionally end a replacement
conference. An overlapping open occurrence with the same stored URL blocks
termination. Calls starting outside the occurrence's scheduled-start/grace window
cannot be safely attributed and are left for host controls. Google provides no
compare-and-swap conference ID on endActiveConference: a narrow external race
between the final GET and POST remains. Unknown external reuse cannot be ruled out.

Only an observed conference disappearing after readback is reported as ended;
no active conference is reported separately. None of this claims recording started.

## Operator rollout (pending)

No new dependency is needed. No hosted migration was applied, no worker was
started and no live Google call was ended during verification.

1. Read `docs/calendar-part2.md` and the Google authorization guide. Existing
   Calendar/import/reminder/executive-access migrations must already be present.
2. Run the combined `supabase/checks/meeting_closure_diagnostic.sql` in the SQL
   editor. Named PASS/FAIL checks cover prerequisites, private grants/RLS,
   management checks, lease triggers, queue versions/deadlines and bounded retries.
   Before rollout the new-schema checks appropriately fail. It is read-only,
   ends in ROLLBACK and returns flags/counts, not credentials or meeting details.
3. Apply `supabase/migrations/20261118100000_meeting_join_windows.sql` through
   your normal migration process. It prepares private jobs for future/currently
   extended occurrences and performs no Google I/O. Do not reapply it. Then apply
   `supabase/migrations/20261119100000_meeting_closure_management.sql`, the forward
   reconciliation for management permissions, durable closure, retry limits and
   reconnect statuses. If November 18 is already installed, apply only November 19.
   Re-run the same diagnostic after applying. Neither migration changes meeting
   viewing RLS or staff accounts. The Supabase CLI is absent locally; no CLI was
   installed and the SQL is supplied for the operator's existing migration process.
4. Joining-window enforcement works without new Google consent. The optional
   server-only `GOOGLE_MEET_CALL_ENDING_ENABLED` defaults to `false`; existing
   authorization remains usable. To attempt Google ending, add the exact scope
   above to your Google OAuth consent configuration, enable the Meet API, set
   this variable to `true`, restart the app and explicitly reconnect the existing
   configured organizer through Settings as active Admin. Handle any Google
   verification/admin-consent requirements. Never expose this configuration or
   tokens to client components. No other extra scope is requested.
5. Keep existing Google client/secret, encryption key and organizer unchanged.
   Missing optional consent does not invalidate the existing base integration;
   it makes Google termination unavailable. A successful reconnect does not prove
   a Calendar-created space is eligible for ending.
6. After reviewing real queued jobs, run `npm run dev` and
   `npm run calendar:worker` in separate terminals. The worker may create/update/
   cancel real Google events and invitations, and now may terminate eligible
   active calls. Do not run against real meetings merely to test this change.

The existing protected `/api/calendar/sync` endpoint processes at most one due
ending per cycle before Google import/sync and private reminders. Call ending has
a bounded budget, short database leases, retry states and safe aggregate counts.
Outbound sync's budget is now 45 seconds to preserve the endpoint's 120-second
runtime. The local worker timeout remains 150 seconds and never overlaps itself.
Production still needs a scheduler and a deployment supporting that runtime.
The EBA redirect cutoff is exact; Google termination occurs on a later scheduler
tick plus processing time, not exactly at the deadline. Backlogs, outages and
denied permissions can delay or prevent termination. Temporary failures retry at
1, 2, 4, 8, then at most 15 minutes, up to eight attempts. Exhausted jobs require
manager retry. Permissions/unsupported spaces and shared-space conflicts require
manager action rather than repeated provider attempts. Missing scope or disabled/
revoked organizer access shows **Reconnect Google required**. Enable the optional
flag, reconnect in Settings and explicitly retry as the occurrence's manager.
The worker persists overdue Hub closure before checking Google credentials; the
protected redirect enforces the deadline even if that worker never runs. Shared
space conflicts require operator review rather than ending another
occurrence. Scheduling/link edits briefly fail with retry guidance during a live
termination lease. Rescheduling replans the due time/version and clears obsolete
automatic status; occurrence-level manual closure remains explicit.

## Verification and controlled acceptance

`npm run test:calendar:calls` uses injected clocks, mocked Google and actual route
handlers. It makes no network calls and covers start/exact-cutoff boundaries,
Lagos midnight, recurrence independence, cancelled/manual closure, saved EBA links,
Admin/CEO denial, provider permission failures, ambiguous responses, conference
replacement and shared-space fencing. SQL checks in this suite are static
contracts, not execution against hosted Postgres. Run the remaining calendar,
Google, reminder, worker, import, rendering suites, lint, TypeScript and build.

For live acceptance after migration, explicitly use a disposable meeting and
informed test participants. Do not change system clocks or the three-hour rule:

1. As Admin schedule an occurrence inviting CEO. Before start, both see disabled
   Join; directly opening its EBA Join endpoint returns 409. At start both can join.
2. Keep the call open past scheduled end. Join stays active. At end + 3 hours,
   both clients disable it, and the saved EBA redirect returns 410. Wait for a
   scheduler tick and inspect the termination status; only claim success after
   both Google participants are disconnected and EBA confirms the observed call
   ended. If Google denies this space, verify unavailable and use host controls.
3. On a separate active disposable call, Admin confirms End. Both EBA Join links
   close immediately; inspect the distinct Google result. CEO calling the same
   POST `/dashboard/calendar/api/<occurrence-id>/end` must return 403, and a
   cross-origin Admin request must be denied. No Admin End before scheduled start.
4. Repeat the request and simulate a temporary provider failure in a test
   environment: retries must not terminate a new/replacement call. Test same-link
   overlapping occurrences are reported as blocked. Do not share production links.
5. Reschedule a future occurrence and confirm its due time follows the revised
   end. Cancel it and confirm its job is cancelled. In a weekly series, close one
   occurrence and verify the next opens at its own start. Editing the remaining
   series must preserve the existing recurrence/organizer rules.
6. Test missing optional scope and disabled flag: EBA closure succeeds while the
   UI truthfully says Google termination unavailable. Base synchronization and
   Settings connection must remain usable. Do not interpret Connected or
   automatic recording configured as a guarantee of either recording or ending.

7. Sign in as a different active Admin who can view the occurrence. Its details
   must say management unavailable and its end POST must return 403. Repeat for
   signed-out, inactive and cross-origin callers. Imported foreign-organizer
   records must never enable ending; the current importer already excludes these.
8. Save a notification before ending. Leave the bell, Calendar detail and Overview
   open in separate tabs. After manual ending, focus/poll must show Closed and
   disable Join without waiting for the grace deadline. Old EBA redirect is 410.
   Follow a previously shared direct Google link only in this disposable test:
   it may still work. That is a provider limitation, not evidence that EBA reopened.
9. In a disposable test environment pause the end provider immediately before its
   final POST. A simultaneous schedule edit must return retry/conflict while the
   lease is live. After releasing/expiring the lease, rescheduling must atomically
   update the pending job's occurrence version and due time. Two workers and a
   repeated Admin request must not acquire simultaneous live leases or end a new
   conference. Inspect aggregate invariants with the combined diagnostic.

The UI shows Upcoming, Join Meeting, Grace period and Closed, plus the exact Lagos
closure deadline. Its clock samples a private server-time endpoint and advances
with the browser monotonic clock, rather than trusting the desktop wall clock for
countdown updates. The redirect always uses server time. Details/notifications
recheck every 15 seconds and on focus; other-device manual closure is consequently
eventual in the UI, while its server enforcement is immediate.

Google SpaceConfig.RESTRICTED controls who can enter without knocking; it still
allows invitees. CREATOR_APP_ONLY limits entry to an app's own embedded entry
points; this app uses normal Calendar-created Meet links, not that embedded flow.
Neither is used as a false permanent lock. This change does not patch access type,
cancel Google events as a substitute for ending, or rotate/delete shared links.

Local verification uses mocked Google/DB adapters, injected time, actual HTTP
handlers and static SQL contracts. No hosted SQL/RLS/concurrency execution, live
Google eligibility or participant disconnection is claimed. Those remain operator
acceptance checks. No dependencies were installed, no hosted migrations applied,
and no real calls terminated.

The actual rendered controls were also exercised in a local headless Chrome
fixture with synthetic records and mocked HTTP. Confirmation defaults focus to
Keep meeting open, traps Tab/Shift+Tab, supports Escape, refreshes an old
notification after manual closure, and leaves zero active Join links at cutoff.
The 390px mobile fixture has no horizontal overflow. This is isolated component
verification, not a live signed-in dashboard or Google conference test.
