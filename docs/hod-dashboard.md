# HOD dashboard rollout

## What the HOD role can access

An HOD must have an active `hod` membership, a verified `@enibrand.com` Auth account, and at least one real row in `staff_department_assignments`. The checks run again on protected requests. Employee and client accounts remain outside `/dashboard`.

- **Overview:** assigned department submitted plans, the HOD’s own requests, authorized meetings, Connect counts, authorized announcement history, and published monthly recognition.
- **Projects:** create and edit the HOD’s own drafts for assigned departments and week/month/year periods; assign new work items to verified active staff/HOD IDs; submit once for CEO/Admin oversight. Submitted plans are read-only. Existing free-text task owners and legacy drafts are not converted or attributed.
- **Approvals:** submit supported requests and view only requests and protected files created by the signed-in HOD. HODs cannot decide requests.
- **Connect:** General, assigned private department rooms, and participant DMs, using existing room and media checks. Membership changes take effect on subsequent protected reads.
- **Calendar:** view meetings organized by or explicitly addressed to the HOD; create a one-off or weekly department meeting for currently assigned departments and active assigned HOD/CEO/Admin attendees. Editing/cancellation, visibility changes, Google controls, recording controls, and End for everyone remain unavailable to HODs. Existing join rules are retained.
- **Announcements:** read, acknowledge, and revisit only currently published announcements in the company or assigned-department audience.
- **Recognition:** published Employee of the Month, Best Teamwork, and Most Improved results only.
- **Games:** create/join open rooms and accept invitations. Invitation targets for an HOD are limited to active HOD/CEO/Admin accounts sharing a real department assignment. Game Night scheduling/status remains Admin-only.
- **Settings:** own profile only. Staff access and Google settings remain executive-only.

The Overview now shows current submitted-plan and assigned-task counts, unread Connect
messages, pending approval summaries for current assigned departments, upcoming meetings
for the signed-in account, published recognition, available announcements, and two game
shortcuts. The project schema has no project lifecycle/status table, so submitted plans
are labelled as plans and are not presented as a verified active-project count. HOD
approval queue cards contain only request type, department, and submission date; request
details and files remain requester-only, and CEO/Admin keep decision authority.

Employee activity totals remain unavailable. Historical plan items use free-text owners and have no reliable completion event. New HOD plan tasks store a verified assignee ID, assignment time, and HOD-reported completion time/actor. That is not independently verified work evidence, so Insights does not calculate activity statistics from it.

## Admin setup

1. In **Settings → Staff access**, use **Invite staff**.
2. Enter the person’s real, existing `@enibrand.com` Auth email and name.
3. Select **HOD** and the department the person will lead. The invitation process remains recipient-bound and checks the verified account at acceptance.
4. Copy and privately share the invitation link with its intended recipient. EBA Hub does not send an invitation email and does not provision a mailbox.
5. After acceptance, an active verified HOD lands on the dashboard. Use **Edit assignment** to add or remove department assignments; multiple selections are saved together. Never use plan owners or chat history to infer an assignment.

## Migration and deployment order

1. Run [hod_dashboard_preflight.sql](../supabase/checks/hod_dashboard_preflight.sql) read-only against the intended database.
2. Ensure the existing migrations through `20261122140000_most_improved_evidence_constraint_repair.sql` are already applied or apply the outstanding historical migrations once, in timestamp order. Do not rerun applied migrations.
3. Review and apply the new forward migration `20261125100000_hod_dashboard_access.sql` after all of its prerequisites. It is not applied by this change.
4. Run [hod_dashboard_verification.sql](../supabase/checks/hod_dashboard_verification.sql) and require every row to say PASS.
5. Deploy the matching application build. Do not enable Employee access or send invitations during implementation.

For the new Overview/approval summary changes, run
[hod_overview_preflight.sql](../supabase/checks/hod_overview_preflight.sql), apply
`20261126100000_hod_overview_access.sql` after the HOD access and Connect contract
migrations, then run [hod_overview_verification.sql](../supabase/checks/hod_overview_verification.sql)
and require its single result to be PASS before deploying the matching application.

### Recovery for `42P13` on `connect_department_members(uuid)`

The migration file starts with `BEGIN` and has its only `COMMIT` at the end.
`connect_department_members` fails at line 226, before that `COMMIT`; the file
contains no earlier commit or known nontransactional DDL. When run in order as
one PostgreSQL script, that failure aborts the transaction and preceding changes
roll back. Still inspect the actual schema and migration ledger before retrying:
a SQL editor, wrapper, or manually split execution could have different commit
boundaries, and the migration history does not prove database state by itself.

1. Run the read-only [Connect contract diagnostic](../supabase/checks/hod_connect_members_contract_verification.sql), inspect the remote migration list for `20261125100000`, and inspect all HOD objects. Do not infer schema state from the migration ledger alone.
2. If the version is **absent** and inspection confirms a clean rollback (no HOD migration objects changed, base three-column function and grants intact), apply the corrected [pending HOD migration](../supabase/migrations/20261125100000_hod_dashboard_access.sql) once after preflight. Its Connect function now preserves `(user_id uuid, display_name text, avatar_url text)`. Do not rerun it if any preceding objects persisted.
3. If the version is **applied** and the function returns five columns, apply the forward [compatibility repair](../supabase/migrations/20261125110000_hod_connect_members_contract_repair.sql). It checks catalog dependencies, refuses unexpected shapes, drops without `CASCADE`, recreates the established three-column contract, and restores execute access only to `authenticated`.
4. If HOD objects exist but the version is absent, treat this as partial application: do not rerun the HOD migration or edit the ledger yet. Snapshot the database, inventory every statement/object against the HOD migration, then complete only missing changes through a reviewed forward reconciliation migration. Run the HOD verification diagnostic; only after the schema is fully reconciled may migration history be marked applied. Ledger repair changes history only; it does not execute SQL.
5. If the version is applied and the function already has the correct three-column result and grants, do not rerun either migration; run the HOD verification diagnostic and deploy the matching app.

The repository currently has no connected Supabase project, so the hosted
migration ledger and actual partial schema state cannot be determined here.

## Two-department acceptance test (isolated staging only)

Use disposable test accounts and fixtures in a local/staging database. Do not create fixtures in production.

1. Create one active verified HOD assigned to Graphics and Communications, a second active verified HOD assigned only to Marketing, and active Admin/CEO fixture accounts. Add one active assigned staff fixture for plan task assignment. Keep an ordinary Employee and a Client Portal fixture for denial checks.
2. Sign in as the first HOD. Confirm Overview, Projects, Approvals, Connect, Calendar, Announcements, Recognition, Games, and profile Settings load. Confirm Clients, staff management, Google controls, nomination/review forms, and result publication are unavailable.
3. Confirm both assigned department tabs appear and no department is silently preselected for a multi-assignment account. Create a Graphics draft, assign a work item to the real assigned staff ID, save, edit with the expected version, and submit. Verify submitted plan is read-only and CEO/Admin can see it.
4. Verify the Marketing-only HOD cannot read or edit the Graphics plan or task, private Connect room, message, attachment, voice recording, calendar occurrence (unless explicitly invited), or announcement. Try direct requests using known IDs. Reassign the first HOD away from Graphics; repeat on the next protected request and live refresh. Deactivate the HOD and repeat.
5. Verify request creation and attachments are requester-only; direct CEO/Admin decision APIs remain executive-only. Check Calendar creation rejects departments outside the HOD’s current assignments and supports only eligible assigned attendees. Confirm End for everyone and Google/recording controls are denied.
6. Verify published announcement and recognition access while draft, nomination, review, management, and publication records remain hidden. Verify Games invitation rooms remain invite-only and an HOD cannot invite a user without a shared real department assignment. Confirm Admin Game Night controls remain available.
7. Verify ordinary Employee and Client Portal sessions are denied from HOD dashboard routes and HOD-only RPCs.

These are acceptance instructions. No database or browser fixture run was available during this implementation.

## Rollback

Do not delete the migration ledger row or rerun earlier migrations. If the HOD rollout must be disabled, first disable HOD membership in the existing Admin access workflow. For a database rollback, prepare and review a separate forward containment migration that removes HOD-only policies/RPC grants and restores the prior executive gates. Preserve memberships, assignments, plans, task IDs, approvals, messages, media, meetings, reminders, announcements, recognition, game rooms, and audit history. Do not drop or rewrite user data.
