# Occurrence joining windows and Google call ending

Join opens at the occurrence's scheduled start, including that instant, and
closes at scheduled end plus three hours, excluding that instant. Instants are
stored in UTC and displayed in Africa/Lagos. Calendar, Overview, bell meeting
notifications and the protected Join redirect use this rule. Browser controls
update each second and on focus; the server independently checks every redirect.
Cancelled occurrences and explicitly Admin-closed occurrences cannot join.
Each weekly occurrence has its own window; closing one never closes the series.
Upcoming retains overrunning occurrences through their grace period.

Active Admins can open a meeting's details and choose **End meeting for everyone…**.
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
ending a call. References checked November 18, 2026:

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

## Operator rollout (not performed by the agent)

No new dependency is needed. No hosted migration was applied, no worker was
started and no live Google call was ended during verification.

1. Read `docs/calendar-part2.md` and the Google authorization guide. Existing
   Calendar/import/reminder/executive-access migrations must already be present.
2. Run `supabase/checks/meeting_join_windows_preflight.sql` in the SQL editor.
   It is read-only and returns setup flags, not credentials or meeting details.
3. Apply `supabase/migrations/20261118100000_meeting_join_windows.sql` through
   your normal migration process. It prepares private jobs for future/currently
   extended occurrences and performs no Google I/O. Do not reapply it.
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
denied permissions can delay or prevent termination. Unavailable jobs retry with
backoff; shared-space conflicts require operator review rather than ending another
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

Live Google eligibility, participant disconnection and hosted SQL/RLS execution
remain operator acceptance checks; mocked verification cannot establish them.
