# EBA Hub announcements

## Release order

1. Run `supabase/checks/announcements_preflight.sql` read-only. Resolve any name collision or missing prerequisite before continuing.
2. Apply pending migrations in filename order. The announcement migration is `20261121120000_announcements.sql`; it depends on the existing staff membership and department assignment tables and follows `20261121100000_private_department_rooms.sql` in this checkout.
3. Run the single combined read-only diagnostic `supabase/checks/announcements_verification.sql` and confirm every row says PASS.
4. Perform the hosted acceptance run below in a controlled staging environment before production.

The migration creates no announcements, recipients, jobs, notifications, or external deliveries. It must not be run against a hosted database as part of this implementation task.

## Access rules

- Dashboard actions and database functions require an active, verified `@enibrand.com` CEO/Admin account. Employee/HOD dashboard access remains disabled.
- An author alone may read their drafts and may edit or archive their own records. Active CEO/Admin accounts may read published and archived management records, but cannot edit or archive another author's record.
- Department recipients are resolved at read time from the current `staff_department_assignments` rows and active membership state. A role or assignment change therefore takes effect on the next request, including history and acknowledgement. During the current rollout, HOD/Employee accounts still cannot enter the dashboard or call recipient handlers successfully.
- Acknowledgements are unique per announcement, publication revision, and user. They are independent of bell notification `read_at` state.
- Published edits create a new unpublished revision and retire the old revision from recipient access until the author republishes it. The record remains auditable. Archive and expiry make recipient reads unavailable.
- Announcement tables are not added to the Realtime publication. The client polls a small, authorized `announcement_next()` result and receives no broad row payload. It does not claim email or browser push delivery.

## Two-account hosted acceptance

Use two existing, active CEO/Admin accounts in a staging project with different real department assignments. Do not change real account memberships. Choose a department assigned to Account A and not Account B; if there is no such existing pair, report audience isolation as unverified rather than manufacturing assignments. The flow intentionally creates only clearly labelled temporary test announcements in staging; do not run it against production without approval.

1. As A, save a clearly labelled draft addressed to the selected department. Confirm A sees it in Drafts, B cannot list/read the draft by page, direct table query, or guessed ID, and the signed-out request is denied.
2. Publish it with the confirmation dialog. Confirm B can see the published management record as CEO/Admin but cannot edit or archive A's record. Confirm A can manage it.
3. As B, attempt the recipient next/history endpoints and acknowledgement RPC. Since B lacks the target assignment, no body is returned and acknowledgement fails. In an isolated fixture account with a matching assignment, confirm the opposite result. Verify the target assignment is not inferred from title, other attendees, or role.
4. For an eligible matching user, open the recipient modal. Confirm a focused input, open modal, and voice recording/preview defer it; it appears once those activities end. Acknowledge with “Got it”, sign in again and on a second device, and confirm this revision does not repeat. Confirm the bell unread state is unchanged.
5. Edit A's published record. Confirm a new draft revision is created, recipient history no longer exposes the superseded revision, and no popup appears before republish. Republish, then confirm the new revision appears and has a separate acknowledgement.
6. Publish another test item with a short expiry, confirm it is available before expiry and unavailable after expiry. Archive a current item and confirm direct history and acknowledgement requests fail immediately afterward.
7. Deactivate a non-privileged fixture user or change its assignment in the isolated staging fixture. Confirm the next protected request denies access. Confirm General and participant-only DM behavior remains unchanged, and confirm no Employee/HOD dashboard was enabled.
8. Verify Realtime explicitly: the combined diagnostic must show PASS for absence from `pg_publication_tables`; under B's session, a direct Postgres Changes subscription to announcement tables must not produce announcement body rows. Confirm the prompt uses the protected `announcement_next` HTTP route instead. Capture only PASS/FAIL statuses; do not export staff rows or announcement bodies into diagnostics.

These hosted steps are not replaced by `npm run test:announcements`: that command uses local fixtures, static SQL contract checks, and mocked Supabase RPC responses. It cannot verify hosted RLS behavior, account state, Realtime configuration, or browser focus behavior against the deployed app.
