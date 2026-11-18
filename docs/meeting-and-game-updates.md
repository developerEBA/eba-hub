# Meetings, Overview and game alerts

**Current executive-access rule:** the user subsequently requested that everything
include CEO and Admin. The `20261117163000_executive_meeting_access.sql` forward
migration supersedes the company/private executive visibility distinction described
below. Every active CEO/Admin sees every existing and future EBA meeting, regardless
of audience tag or explicit invitation, in Calendar, detail, protected Join and the
appropriate day's Overview. No per-meeting sharing/classification is needed.
All other roles remain excluded from the current dashboard rollout. Editing,
cancellation, classification and native retry remain organizer-only. This changes
EBA visibility, not Google guest/co-host lists; Google's admission rules still apply.
Reminder recipients remain the organizer and explicit active invitees.

Review `supabase/executive-meetings-preflight.sql` read-only, then apply
`supabase/migrations/20261117163000_executive_meeting_access.sql` yourself after the
previous calendar/import migrations. No migration was applied by the agent. The
app now removes participation filters for authenticated CEO/Admin requests; database
RLS independently applies the active executive gate. **Until the forward migration
is applied, the old database policy can still hide meetings.** This preserves column
privacy and browser write revocations. The migration also aligns recording-setting
confirmation with executive read access while retaining connection/version/URL checks.

Acceptance after applying: CEO and Admin must see all seven records for 16–22 Nov
2026 without changing their audience tags; an inactive or staff-only account must
still be denied. An executive who is not the organizer must not edit/cancel/retry
another person's meeting. No Google event, account, reminder job or audience value
is changed by applying this access migration. Hosted RLS verification remains an
operator step; mocked query/SQL-contract tests are not a live-session guarantee.

The requested HOD/employee dashboards remain deferred: no roles, accounts or
department assignments were created, inferred or enabled. Future audience rules
are General + Leadership + own assigned department for HOD, and General only for
employees. These are a future rollout specification, not active access today.
Meeting titles are never used to infer audience or department.

## CEO visibility and today’s Overview

Organizers/coordinators can open their meeting detail and use **Meeting visibility**
to mark it Private, Company, General or HOD/Leadership. Explicitly company-classified
meetings are visible to active CEO through both server filtering and occurrence RLS.
Private meetings remain organizer/invitee-only. All existing/new meetings default
to Private; imports never silently publish them. An invited viewer or CEO who only
sees a company meeting cannot change its visibility. The service-only RPC rechecks
organizer identity, unchanged account eligibility and visibility version in one
transaction. Audience changes do not edit Google, restart reminders or export
duplicate events. Imported business fields remain read-only.

To show current company meetings to CEO after migration, their EBA organizer must
explicitly save their visibility. Future department classification/access should
use real department assignments when that rollout is implemented. Setting Company
does not add Google guests or co-hosts: Google's own admission rules still apply.

Overview now shows **Today’s Meetings**, using the complete Africa/Lagos day,
including already-ended and ongoing meetings. It no longer drops today's entries
merely because their end time passed or there are more than three. Cancellation
still removes the occurrence. Existing Calendar Upcoming stays future/ongoing.

## Communications / imported Meet preparation

An imported Google event without a valid Google Meet URL used to say Preparing
indefinitely. It now honestly says **No Meet link in Google** until a usable URL
exists. After the preparation migration, each worker cycle rechecks/prepares one
already-imported, scheduled, unended event owned by the connected Google organizer.
Missing links that have not yet been attempted are prioritized; other events rotate
by individual check time. Ordinary list scans no longer reset every check timestamp,
which previously could repeatedly favor the first records.

Preparation patches only conference creation data on the existing Google event,
with an ETag and stable request ID. It never inserts a replacement event, changes
guests/title/time, or overrides another conference provider. A pending conference
is polled without creating another. Google can take another cycle to supply a link.
For an existing/new usable Google Meet link, the worker reads the matching Meet
space and configures automatic recording ON. Configured is displayed only after
Google returns ON. Failures produce a recording warning, keep any usable link, and
are retried on later individual rechecks. Past, foreign-organizer and native EBA
events are excluded from this import preparation path. Native preparation remains.

**This does not guarantee recording when any guest enters.** Google's current
[recording requirements](https://support.google.com/meet/answer/9308681?hl=en)
require an eligible host/co-host to join on the web. EBA test Admin authentication
does not make that person the Google host. Join using the connected organizer's
eligible Google account, or have an eligible co-host assigned through Google join.
The [Meet space API](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces)
controls auto-recording configuration, not an unconditional start-recording command.
Google recording indicators/consent remain; EBA never claims recording is running.

The import budget is now 25 seconds; automatic outbound work has a 65-second
budget in the shared endpoint, retaining its five-item cap and default 85 seconds
for direct/manual invocation. The two bounded reminder batches remain before/after
this work. No work is unawaited. The 120-second endpoint and 150-second local
transport timeout remain. A platform scheduler/runtime is still needed in production.

## Game invitation alerts and sound

New game invitations insert an in-app notification for the invited active verified
CEO/Admin, in the same transaction as the invitation. A unique recipient/room key
prevents duplicate notifications on invitation retries. A composite FK ensures
that alerts cannot exist for noninvitees and cascade when an invitation is removed;
a later genuine reinvitation can create a fresh alert. Recipient/active-account RLS
and a restrictive current-invitation policy protect reads and mark-read. No General
or department message is posted. Room links use the existing protected Games flow.
The migration does not backfill/send alerts for old invitations.

All new unread bell alerts now use a clearer two-note triangle chime at gain 0.22,
independent of quieter game background music. Initial load, mark-read, metadata
updates and reconnects do not replay old alerts. Browser audio requires one user
click/key interaction first; OS volume, browser tab mute and closed browsers remain
outside the app's control. This milestone adds no push/email/SMS notification.

## Operator setup and verification

No dependencies, accounts, credentials, hosted migrations or live jobs were changed
or started by the agent. Before starting worker, run
`supabase/meeting-updates-preflight.sql` read-only and confirm Parts 1–3, base import
and verified import-owner migrations are installed. Then review/apply these forward
migrations yourself, in order:

1. `supabase/migrations/20261117150000_game_invitation_notifications.sql`
2. `supabase/migrations/20261117151000_calendar_company_visibility.sql`
3. `supabase/migrations/20261117152000_imported_meeting_preparation.sql`

Restart `npm run dev` and `npm run calendar:worker` in separate terminals only when
ready. **The worker can modify real Google conferencing/recording configuration,
create existing outbound Google invitations, and deliver private reminders.** None
of these Google operations occurs merely by applying the migrations or building.

Run `npm run test:meeting-updates`, plus the existing Calendar, import, Google,
reminder, worker and rendering suites, lint, TypeScript and production build. Tests
use injected clocks and mocked Google/database/browser audio. SQL contract checks
are not hosted PostgreSQL execution evidence. After migration, operator acceptance:

1. As organizer Admin, mark one test meeting Company. CEO sees it in Calendar and
   Today's Meetings on its Lagos day; an unrelated private meeting stays hidden.
   Invited CEO cannot change another organizer's audience. Change Company back to
   Private and confirm uninvited CEO detail/Join become unavailable. Test an audience
   version conflict in two tabs. No Google event guest list changes from classification.
2. Allow Communications' imported organizer-owned event to be rechecked. Confirm
   the same Google event gets a valid Meet link and recording ON is returned before
   EBA says configured. Repeated cycles produce no duplicate event or conference.
   Join with the eligible host/co-host on web and observe Google's actual recording
   indicator. Guest-only join must not be presented as proof of recording.
3. Create several meetings today, including an earlier one; Overview shows them all.
   Cancel one and confirm it disappears. Check the Lagos midnight boundary.
4. Click once in CEO's dashboard to unlock browser audio. Admin invites CEO to a
   game: CEO gets one bell entry, audible chime, unread count and protected room link.
   Retrying the invite produces no duplicate/chime. Mark read/all and refresh/reconnect:
   no replay. An uninvolved account sees no notification. Test with browser audio
   enabled; actual device loudness is a live operator check, not a unit-test claim.

All live Google, hosted RLS/trigger/concurrency and real-device audio checks remain
pending until the operator applies migrations and performs these steps.

Implementation verification: 76 relevant automated checks passed (12 meeting/game
updates, 11 import, 10 reminders, 24 outbound Google, 8 Calendar, 7 worker and 4
rendering). Lint, TypeScript and webpack production build passed; sandbox output
directory EPERM required retrying the build outside the filesystem sandbox. The
21st review found zero issues across the five updated UI components. Browser plugin
was unavailable, so existing Playwright MCP checked isolated actual-component SSR
fixtures at 1280px and 390px: invitation link and audience selector rendered,
selection changed, no horizontal overflow or page errors. This is fixture layout
evidence, not authenticated RLS, persisted UI interaction or audible-device proof.

## Overview card presentation update

The reference-style card is labelled Upcoming Meetings with Today’s schedule /
Lagos time beneath it. It preserves the full-day data above, with compact accent
rows, stacked real participant photos/initials, video icons, a header View All and
protected green Join Meeting buttons. Missing links show a neutral pending action.
Profile enrichment is deferred until after initial rendering, uses the signed-in
client’s existing profile RLS, reads only current meeting participant IDs (max 100),
and times out without hiding meetings. No new schema, dependencies or profile data
is created. Larger daily lists scroll inside the card.

## Confirm a setting already enabled manually in Google

Meeting details now provide **Check recording in Google** for an authorized viewer
of a scheduled meeting with a valid Meet link. The action uses the existing Google
authorization and performs Google GETs only: it verifies the actual organizer/event
and current Meet URI, then reads the matching space's automatic recording setting.
It does not enable recording, create recordings, patch events or change guests.
ON is confirmed; OFF is reported as off; missing/unknown/denied results are not
treated as confirmation. The old pending label is now **Automatic recording not
yet confirmed**. A manually started recording is distinct from automatic recording:
this settings scope does not establish that a recording is currently running.

Apply `supabase/migrations/20261117160000_recording_setting_confirmation.sql`
yourself after the migrations above. It adds one service-only confirmation RPC,
no accounts, credentials or new columns. Run
`supabase/recording-confirmation-preflight.sql` read-only first. No dependency or
scope change is required. EBA rechecks active account and participant/CEO-company
access, meeting version/URL/status and enabled Google connection generation before
committing a status. A stale/cancelled meeting or disconnect cannot receive a new
confirmation. Database persistence must succeed before the action reports success.

Live operator check after applying migration: open the meeting, click **Check
recording in Google**, and verify ON becomes confirmed. Toggle automatic recording
in Google on a controlled test event and recheck: OFF must be reported honestly.
A guest merely starting/stopping recording does not prove that the automatic
setting changed. Uninvited, inactive, cancelled or cross-origin requests must be
denied. These live cases and hosted SQL execution were not performed by the agent.
Automated checks use mocked Google ON/OFF/unknown/failed persistence and verify
that no Google patch/recording-configuration method is called.
