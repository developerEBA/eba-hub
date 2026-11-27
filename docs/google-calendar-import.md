# Google Calendar → EBA: focused first version

The existing worker now imports timed events owned by the configured connected
organizer from their **primary** Google calendar. It reads yesterday through the
next 90 days, including meetings already in progress. One page (100 events) per
cycle is checkpointed in private storage. After a complete pass, the rolling window
starts again. Each cycle also rechecks one known scheduled event, oldest checked
first, so deletions or moves outside the listing window eventually reconcile.
Google recurring instances are expanded into independent read-only occurrences;
EBA-created weekly scheduling remains unchanged. This is polling, not instant push.

Only existing verified active CEO/Admin staff are matched by attendee email, excluding
declined invitations. By default, the configured Google organizer must match an existing verified
active rollout account. An explicit verified Admin mapping is available through the
additional forward migration described below. No people, departments or groups are created. External guests
are ignored, and their addresses are not exposed in EBA. Organizer-only events are
supported without fabricating an attendee. Existing row-level participant access
applies to Calendar, Overview, reminders and protected Join. Google invitation changes
take effect in EBA after the event is imported again; access cannot reflect changes
that have not yet been polled. Admin role alone does not reveal other meetings.

Imported records say **Imported from Google Calendar** in detail. Edit/cancel in
Google; EBA's UI, mutation API, retry API and database guard reject local changes.
Imported records never enter the outbound sync queue. Existing EBA-owned provider
identities are preserved and skipped by the importer, preventing duplicate events
or invitations. Existing valid Meet links can be used, but importing does not create
a Meet link or configure/guarantee recording. Recording remains managed in Google.
All-day events, events longer than 24 hours, calendars other than primary, and
meetings owned by other organizers are outside this version. Invalid/incomplete
known events fail closed by cancelling the local imported record. A partial page or
failed scan never cancels records merely because they were absent from that page.

## Apply and run

### Different Google and EBA account emails

The original importer required `auth.users.email = GOOGLE_ORGANIZER_EMAIL` and an
eligible real membership. OAuth/outbound operations do not require that identity
equality: an active EBA Admin authorizes a separately verified configured Google
account. Therefore `eligible_connected_organizer=0` does not imply a broken Google
connection. `calendar_reminder_account_active()` checks real membership active,
CEO/Admin role, company email, verified email, not deleted and not currently banned.
It remains unchanged. The original importer did not support an Admin mapping.

For the supplied account arrangement, keep both accounts and Google credentials as
they are. Run `supabase/google-calendar-import-diagnostic.sql` read-only first.
It identifies missing user/membership, inactive role, unverified/deleted/banned
account, connection metadata, and successful authorization proof without printing
credentials or Google identity identifiers. The two literal account emails in that
diagnostic are the user-provided test configuration; change them for another setup.

Then, after the base import migration, review/apply this **additional forward
migration yourself**:
`supabase/migrations/20261117133000_google_import_verified_owner.sql`.
It does not touch credentials, OAuth authorization functions, sessions or accounts.
Set the following **server-only** explicit import delegation in `.env.local`.
These `example.test` values are placeholders; replace them with the existing
authorized organizer and verified active Admin for your environment. Do not
commit account addresses or production values:

```dotenv
GOOGLE_ORGANIZER_EMAIL=google-organizer@example.test
GOOGLE_IMPORT_OWNER_EMAIL=hub-admin-test@enibrand.com
```

Do not change GOOGLE_ORGANIZER_EMAIL to the EBA login email. The Google identity
must still match the configured organizer exactly. Restart app/worker only when
ready to process real queued work. The worker passes the explicit mapping email
server-side; there is no public mapping endpoint or browser setting.

The resolver requires that exact existing Admin to satisfy all unchanged account
eligibility checks, and proof that this same Admin successfully completed OAuth for
the current Google connection. Proof requires consumed + successfully saved state,
matching organizer email and the `saved_at = connected_at` timestamps written in
the same successful authorization transaction. A failed, denied, merely started,
different-Admin or older-connection flow does not qualify. It never chooses an Admin
by role/domain or by “first active user”. No membership for admin@ is fabricated.

On the first valid worker claim the proof is copied into private durable mapping
metadata (Admin ID and verified Google identity/connection association, no tokens).
The mapping is bound to Google email, verified subject and successful connection
timestamp; current Admin eligibility is rechecked at claim and finish. Disconnect
blocks use, and reconnect needs proof for the new connection. The page lease is
also bound to the resolved owner. Existing imported rows with a different owner
fail for explicit review rather than silently transferring ownership.

This is **explicit delegated ownership** of imported organizer-owned meetings: the
configured verified Admin becomes their EBA coordinator/organizer for participant
RLS and private reminders. It is not an automatic participant privilege for every
Admin. Other invitees still need exact email matches and eligibility. No occurrence
RLS policy or attendee eligibility function is loosened. Imported edits stay in Google.

OAuth state history is intentionally temporary: starting a later authorization
deletes expired states. If there is neither a current durable mapping nor matching
saved proof, the resolver fails closed. Do not guess/backfill a mapping or reuse an
arbitrary old state. The operator may later complete a deliberate reconnect as the
intended existing Admin, then run import to establish the mapping. **No reconnect
or credential change is performed by this diagnostic or migration.** A missing
proof cannot be repaired just by setting the environment variable. A valid durable
mapping continues after temporary OAuth states are cleaned up.

After the mapping migration, `supabase/google-import-owner-verification.sql` checks
the current durable mapping and browser denials read-only. Before the first valid
worker claim a missing durable row is expected if matching saved OAuth proof exists.
After establishment, a false temporary-proof flag alone is not a failure when the
current durable mapping is valid.

Leaving GOOGLE_IMPORT_OWNER_EMAIL blank retains the original strict exact-email
mode. Applying the mapping migration alone does not select or link any account.

Mapping verification after application: service-role-only table/function privileges
must deny browser roles; wrong Admin, missing/failed proof, inactive/unverified Admin,
disconnect/reconnect identity change, and owner changes during a lease must deny.
Run `npm run test:calendar:import`; tests mock RPC/auth and inspect SQL contracts.
Hosted execution/RLS and live import acceptance still require operator verification.

No dependency install, new OAuth scope or new environment variable is needed.
The existing `calendar.events.owned` scope permits reading owned Calendar events.
Scope/pagination/recurrence behavior follows Google's official
[events.list documentation](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

1. Apply Calendar Parts 1–3 first. Run
   `supabase/google-calendar-import-preflight.sql` read-only. Confirm the expected
   attendee constraint exists and the five auth column grants are true. Strict mode
   needs one eligible connected-organizer account; explicit mapping mode uses the
   diagnostic/proof checks above instead (the legacy exact-email count can stay zero).
   BYPASSRLS alone is
   insufficient for column privileges. No provider credentials are printed.
2. Apply the forward migration yourself:
   `supabase/migrations/20261117120000_google_calendar_import.sql`.
   Supabase CLI is unavailable locally; this follows the repository's manually
   timestamped migrations without installing a CLI or applying a hosted migration.
3. Restart the development app and existing worker in separate terminals:
   `npm run dev` and `npm run calendar:worker`.
   **The existing worker also processes real outbound Google events/invitations and
   private reminders.** Running it is an operator action, not a harmless preview.
4. Logs should show `google_import=available imported=N`; no meeting details or
   addresses are logged. Google import failure is isolated from outbound work and
   reminders. One leased import page is processed at a time, with 30-second crash
   recovery, a 12-second import budget and idempotent event identity. Page/lease data
   is never browser-readable. Import adds to the existing 85-second outbound and
   bounded reminder work, within the endpoint's 120-second runtime under normal
   bounded operation. Production still requires the existing scheduler/runtime.

For **HOD and Leadership meeting**, confirm Google shows the organizer as the
configured connected organizer and its date falls in the window. After the first
completed scan, the matching Admin organizer sees it in This Week and, while it has
not ended, Upcoming/Overview. An invited active CEO sees it too. If a calendar has
more than 100 events in range, allow multiple cycles. No import can happen before
the migration is applied. No live event was imported during implementation.

## Verification and limitations

Run `npm run test:calendar:import`, `npm run test:calendar`,
`npm run test:calendar:google`, `npm run test:calendar:reminders`,
`npm run test:calendar:worker`, `npm run lint`, `npx tsc --noEmit`, and
`npm run build`. Tests mock Google/database responses; real provider URL construction,
import orchestration, normalization and read-only detail rendering are exercised.
SQL contract assertions do not constitute execution of the forward migration.

After applying it, these checks are read-only:

```sql
begin transaction read only;
select has_table_privilege('authenticated','public.calendar_google_import_state','SELECT') as must_be_false,
 has_function_privilege('authenticated','public.calendar_google_import(text,text,jsonb)','EXECUTE') as must_be_false;
select count(*) as imported_outbound_jobs_must_be_zero
 from public.calendar_sync_jobs j join public.calendar_occurrences o on o.id=j.occurrence_id
 where o.source='google';
select count(*) as duplicate_identities_must_be_zero from (
 select provider_calendar_id,provider_event_id from public.calendar_occurrences
 where source='google' group by 1,2 having count(*)>1
) duplicates;
rollback;
```

Live acceptance (operator, pending): in Google create a timed organizer-owned test
meeting inviting existing CEO, let the worker import it, and confirm both EBA views.
Run another cycle: same occurrence UUID and no duplicate event/invitations. Edit time
and attendees in Google; after polling, both views/reminder schedules follow and a
removed account loses private detail/Join access. Cancel in Google: upcoming removes
it and Join denies access after synchronization. Confirm EBA edit/cancel/retry is
denied, an uninvited account cannot retrieve it, and normal EBA meetings still export.
Use real existing accounts only. Clean up in Google. No hosted migration, live Google
requests, imports, reminder delivery or account creation were performed.
