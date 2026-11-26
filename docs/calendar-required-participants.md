# Required meeting participants

## Eligibility and access

Every upcoming, non-cancelled EBA meeting requires all active, verified company CEO and Admin memberships, plus each active, verified HOD currently assigned to `communications`. Membership must be active, the company email must be verified and confirmed, and the account cannot be deleted or banned. There are no hardcoded mailboxes.

Ordinary HOD access remains occurrence-specific: a HOD sees a meeting only as organizer or attendee. A non-Communications HOD is not added globally; they retain an existing department invitation or an explicit invitation. Required status never grants meeting ownership, edit/cancel rights, call-ending rights, Google-authorization access, or access to department Connect data. Employee dashboards remain blocked.

The attendee UUID array remains the persisted audience used by existing RLS, calendar queries, Join checks and reminder jobs. A private provenance table records explicit, department, Google, mandatory and unclassified legacy sources. The enforcement trigger adds the current required accounts before database constraints. CEO/Admin department targets include active, verified HOD assignments for those departments, and the executive invitation RPC accepts explicit active assigned HODs while retaining its existing locking and idempotency contract. Existing reminder planning and Google jobs respond to audience changes. Membership, assignment, Auth email verification, email, ban-status and account eligibility changes synchronously reconcile upcoming audiences. Calendar RLS and reminder notification RLS check current account eligibility and attendee membership, so stale access and alerts disappear from protected reads and Realtime.

## Legacy meetings

Existing attendee arrays do not record why a person was invited. The migration records each existing attendee as `legacy_unclassified`; it does not relabel them as a mandatory participant or as an explicit invite. Reconciliation preserves these associations because silently revoking a historical guest could remove a legitimate invitation. New or updated meetings receive provenance from the actual form payload and existing department assignments. After migration, role or assignment changes synchronously remove a stale mandatory association only when another recorded invitation source does not remain. If an existing association is unclassified, its access is preserved and the dry-run reports the count for manual review; the operator must resolve those historical rows before they can be safely removed.

The migration does not alter event data or process jobs. It does not delete meetings, send invitations, send reminders, or call Google. Provenance references Auth users rather than staff membership rows so removing a membership does not erase the evidence needed to remove stale mandatory access; deleting the Auth user still cascades that record.

## Migration order

Apply all repository migrations in timestamp order, including the existing HOD migrations, then apply `20261126120000_required_meeting_participants.sql`. Do not rerun or edit an applied migration. Run `supabase/checks/calendar_required_participants_preflight.sql` before and `supabase/checks/calendar_required_participants_verification.sql` after application.

## Dry run and reconciliation

After applying the migration, sign in as an active CEO/Admin and open the Calendar reconciliation endpoint:

```text
GET /dashboard/calendar/api/reconcile-required
```

It returns aggregate counts only. Review `upcoming_occurrences_scanned`, `missing_required_participants`, `safely_removable_stale_mandatory` and `legacy_reason_unknown_preserved`. If the preview is acceptable, an active Admin can apply it with a same-origin POST to the same path. The server rechecks the Admin session, and the database rechecks the actor. Apply locks each upcoming occurrence and changes its version only when the audience changes; existing durable Google sync and reminder triggers then replan work with existing deduplication. Do not call the calendar worker as part of the reconciliation step.

## Google imports

Only events owned by the connected organizer account are imported. The importer attempts an ETag-protected attendee update with `sendUpdates=all` for missing required participants before publishing that event into the Hub audience. External-organizer events are not imported or disclosed; ask their owner to invite the required EBA participants. EBA cannot guarantee Google admission when an organizer or organization policy restricts it. A failed required-invite update keeps the import page on that event for retry, so later events on that page may wait.

## Verification boundaries

Repository scripts exercise mocked HTTP and static migration contracts. They do not execute these SQL functions against PostgreSQL or make Google requests. Run the database acceptance below only in an isolated Supabase project with disposable verified accounts and meetings; never use the production project for fixtures.

1. Apply the repository migrations in timestamp order through this migration in the isolated project. Run `supabase/checks/calendar_required_participants_preflight.sql` before and `supabase/checks/calendar_required_participants_verification.sql` after. The latter returns one PASS/FAIL row and checks the secured RPC grants, provenance tables, audience triggers and the current-audience reminder policy.
2. Create disposable active CEO, Admin, Communications HOD and Graphics HOD accounts with confirmed `@enibrand.com` emails and matching real membership/assignment rows. Also prepare an inactive Communications HOD and an unconfirmed Communications HOD. Do not add their records to production.
3. As CEO, schedule a future one-off and a weekly meeting with no selected invitees. Query each occurrence's `attendee_ids`; both must contain the active CEO/Admin/Communications HOD IDs and not the Graphics HOD. As Admin, repeat with no selected invitees. As a Communications HOD, create a Communications meeting and confirm the same required set. Confirm the occurrence's reminders contain one set per current eligible participant and lead time. As CEO/Admin, explicitly select the Graphics HOD for one private meeting; confirm it persists as an explicit invite. Separately target Graphics and confirm its verified assigned HOD is added as a department invite.
4. Sign in as the Graphics HOD. The new private Communications meeting must not appear in Calendar, detail, Join, attendee listing or its reminder reads. Add that HOD explicitly to another occurrence and confirm only that occurrence becomes visible. Use the authorized meeting-detail page to inspect the persisted attendee list.
5. Attempt a direct `calendar_mutate`/`calendar_hod_create` call from an authenticated browser session; it must be denied by function grants. Then, in the isolated database only, call the server-only RPC with the current service-role connection and omit required IDs from the payload; persisted `attendee_ids` must still include the required IDs. Attempt an occurrence that would exceed 100 attendees and confirm it fails with the explicit attendee-limit error.
6. Remove the Communications assignment, deactivate its membership, and separately test an explicit invite that remains valid. Re-read the meeting, Join, attendee list, reminders and bell alert as the affected HOD: access/reminders must disappear when there is no independent invitation and remain only for the explicit invite. Repeat for an account that becomes unconfirmed. Reassign another HOD into Communications and confirm they appear on upcoming occurrences without being granted access to unrelated meetings.
7. Edit the remaining weekly series and cancel it. Confirm identities/ordinals remain stable, future occurrences gain current required people, cancelled/past rows are unchanged by reconciliation, and no duplicate reminder rows appear. Run the aggregate dry-run GET twice; before apply it must be read-only. Apply once using the Admin same-origin POST, then repeat the GET and POST; the second apply must report zero further audience changes.
8. In a separate disposable Google organizer account, import one owned event. Confirm Google receives deduplicated invitations with `sendUpdates=all` and the event remains a single provider identity. Remove required status, let the durable sync run in the isolated project, then invite that former mandatory participant again manually and confirm later imports preserve the new independent invite. Create an external-organizer event; it must not appear in EBA or be modified, and the organizer-facing Settings message must tell the owner to invite required participants.

The hosted production database and Google account were not available for this implementation. Do not apply or reconcile there until the isolated acceptance passes and a production Admin has reviewed the aggregate dry run.
