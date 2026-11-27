This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Staff authentication setup

1. In this workspace, run the following command to install and lock the Supabase dependencies.

   ```powershell
   npm.cmd install --save-exact @supabase/ssr@0.12.7 @supabase/supabase-js@2.119.0
   Copy-Item .env.example .env.local
   ```

2. Create or open a dedicated development Supabase project. In the project's **Connect** dialog, copy its project URL and publishable key into `.env.local`. Use the publishable key for this app. Keep privileged keys and test passwords out of the workspace.
3. In **Authentication**, enable the Email provider and disable public user signup. Leave anonymous sign-ins disabled. In **SQL Editor**, run [the staff memberships migration](supabase/migrations/20261106000000_staff_memberships.sql) once on the development project. If the project already has a staff membership table, inspect its schema and policies before applying the migration.
4. In **Authentication → Users → Add user → Create new user**, create `eba-ceo-test@enibrand.com` and `hub-admin-test@enibrand.com`. Set a distinct test password for each and enable **Auto Confirm User**. Use disposable test accounts in this development project.
5. As an authorized project administrator, run the following in **SQL Editor** to associate the Auth IDs with their roles. Provisioning is done in the Supabase dashboard for this milestone.

   ```sql
   insert into public.staff_memberships (user_id, role, status)
   select id, 'ceo', 'active'
   from auth.users where email = 'eba-ceo-test@enibrand.com'
   union all
   select id, 'admin', 'active'
   from auth.users where email = 'hub-admin-test@enibrand.com'
   returning user_id, role, status;
   ```

   Check that the statement returned one row for each role.

6. Run `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run dev`. Open [the staff sign-in page](http://localhost:3000/sign-in).

### Development verification

- Sign in as `eba-ceo-test` and then as `eba-admin-test` in separate private sessions. Expect `/dashboard` to show **CEO** or **Admin**. Try a username with mixed case and surrounding spaces to check normalization.
- Sign out from the dashboard and open `/dashboard` directly. Expect a redirect to `/sign-in`.
- In a signed-out session, try the CEO username with a wrong password. Expect the generic sign-in error and a redirect back to sign-in on direct dashboard access.
- Create a third confirmed Auth user, `eba-denied-test@enibrand.com`, with a development password and no membership. Try correct credentials and expect the same generic error. Check that direct dashboard access redirects to sign-in.
- Add an inactive membership for that user and repeat. Then change the membership to active with role `staff` and repeat again. Both should produce the same error and redirect. Use SQL Editor for these development-only changes.

  ```sql
  insert into public.staff_memberships (user_id, role, status)
  select id, 'admin', 'inactive'
  from auth.users where email = 'eba-denied-test@enibrand.com';

  -- Run this separately after testing inactive membership.
  update public.staff_memberships
  set role = 'staff', status = 'active'
  where user_id = (
    select id from auth.users where email = 'eba-denied-test@enibrand.com'
  );
  ```

- For each denied sign-in with a correct password, check browser storage for the absence of `eba-staff-session` cookies and any numbered chunks. Also change a signed-in test Admin's membership to inactive and reload the dashboard to check that the server rechecks access.

## Department Plans development checks

Apply [the Department Plans migration](supabase/migrations/20261106000100_department_plans.sql) after the staff memberships migration in the development project. Then apply [the Admin read access migration](supabase/migrations/20261106000200_department_plans_admin_read.sql). Active CEOs and Admins can read submitted plans. App accounts have read-only table grants, with RLS limiting visible plans, deliverables, and attachments. The private Storage bucket has no app upload policy. Department-scoped HOD authoring is deferred.

To exercise the flow, use a development project administrator to insert a plan in SQL Editor and copy its returned ID. The following date is a Monday. For month and year records, use the first day of the month or year.

```sql
insert into public.department_plans
  (department, period_kind, period_start, title, summary, status)
values
  ('graphics', 'week', '2026-11-02', 'Development verification plan',
   'Test record for checking the staff read flow.', 'submitted')
returning id;

-- Replace PLAN_UUID with the returned ID.
insert into public.department_plan_items (plan_id, title, owner, due_date, status)
values ('PLAN_UUID', 'Review draft artwork', 'Development test owner', '2026-11-06', 'In progress');
```

Upload a non-sensitive test file named `verification.pdf` to the `PLAN_UUID` folder in the private `department-plan-files` bucket using the Supabase Storage dashboard. Associate it with the plan in SQL Editor.

```sql
insert into public.department_plan_attachments (plan_id, filename, object_path)
values ('PLAN_UUID', 'verification.pdf', 'PLAN_UUID/verification.pdf');
```

- Sign in as the development CEO and repeat with the development Admin. Open **Projects**, choose **Graphics** and **Week**, and select November 6, 2026. Confirm the submitted plan, deliverable, owner, due date, and attachment download. Check that another department or period without a plan shows the empty state.
- In SQL Editor, change the test plan to `draft`. Reload as each role and confirm the plan disappears and the previously copied app download URL returns 404. Restore `submitted` to exercise the remaining checks.
- Sign out and revisit Projects and the download URL. Confirm both redirect to sign-in. Verify with the signed-in user JWTs against the Supabase API that both roles can read submitted records and download their attachments, and that neither role can write or read drafts.

### Department Plans release gate

1. Before releasing, run [the database release check](supabase/checks/department_plans_release.sql) in the **target project's SQL Editor**. Release only if it reports that the migration checks passed. It checks the installed tables, grants, RLS policies, and private bucket from both Department Plans migrations. It also works when migrations were applied in SQL Editor without CLI history.
2. In development, use the submitted fixture above and create a second plan with a different department or period and status `draft`. Give both plans a deliverable and a private attachment. Confirm both files exist in the private bucket as a project administrator before testing. Use nonempty, disposable files.
3. Set the following environment variables in a local PowerShell session. The script uses the same fixture IDs and object paths for both roles. Enter passwords at the prompts. Keep them out of source control.

   ```powershell
   $env:EBA_TEST_SUBMITTED_PLAN_ID = 'SUBMITTED_UUID'
   $env:EBA_TEST_DRAFT_PLAN_ID = 'DRAFT_UUID'
   $env:EBA_TEST_SUBMITTED_ATTACHMENT_PATH = 'SUBMITTED_UUID/verification.pdf'
   $env:EBA_TEST_DRAFT_ATTACHMENT_PATH = 'DRAFT_UUID/verification.pdf'
   $env:EBA_TEST_CEO_EMAIL = 'eba-ceo-test@enibrand.com'
   $env:EBA_TEST_ADMIN_EMAIL = 'hub-admin-test@enibrand.com'
   $env:EBA_TEST_CEO_PASSWORD = Read-Host -MaskInput 'CEO development password'
   $env:EBA_TEST_ADMIN_PASSWORD = Read-Host -MaskInput 'Admin development password'
   try {
     node --env-file=.env.local scripts/verify-department-plans.mjs
   } finally {
     Remove-Item Env:EBA_TEST_CEO_PASSWORD, Env:EBA_TEST_ADMIN_PASSWORD
   }
   ```

4. Require a pass for both roles. The script checks actual Supabase Auth sessions, visible records, matching submitted file contents, draft isolation, and denied update and upload attempts. Run only in development. If the upload check unexpectedly succeeds, remove the disposable `release-check-*.txt` file in the test plan folder before investigating.
5. In the app, repeat the sidebar, direct route, and download checks with both development accounts before releasing.

## Approvals development review

1. Use the dedicated development Supabase project and the existing active CEO and Admin accounts. Apply the staff membership migration and both Department Plans migrations first. Then run [the Approvals migration](supabase/migrations/20261106000300_approval_requests.sql) and [the required leave document migration](supabase/migrations/20261106000400_require_leave_document.sql) in SQL Editor. Apply both Approvals migrations to the deployment database before publishing the app. Load the fixtures only in development.
2. In **Storage → approval-request-files**, confirm that the bucket is private. Upload files with these exact object paths using an authorized development project administrator.

   | Object path | Local file |
   | --- | --- |
   | `eba00000-0000-4000-8000-000000000301/launch-artwork.png` | Any non-sensitive PNG, such as `public/images/eba-hub-office.png` renamed for the upload |
   | `eba00000-0000-4000-8000-000000000303/leave-support.txt` | `supabase/fixtures/leave-support.txt` |

3. Run [the Approvals fixtures](supabase/fixtures/approvals_development.sql) after uploading both files. They create six clearly labeled development requests and preserve existing decisions. Run [the leave document check](supabase/checks/approvals_leave_document.sql) to verify rejection of missing files and acceptance of the uploaded fixture.
4. Start or restart `npm.cmd run dev`, sign in as an active CEO or Admin, and choose **Approvals** from the dashboard sidebar. You can also visit [Approvals](http://localhost:3000/dashboard/approvals) directly.
5. Optionally link a request to a submitted development Department Plan by setting `approval_requests.department_plan_id` to its ID in SQL Editor. Review decisions update the request only.

### Approvals acceptance checks

- Use two separate browser profiles. As CEO, select the artwork request, check its private preview and download, then **Approve → Confirm decision**. As Admin, select the website staging request, check **Open website**, then **Request changes**. Verify an empty note is rejected and a valid note is saved.
- Refresh both selected requests, then find them in **Decided**. Check each reviewer email, action, timestamp, and any note.
- Reject the campaign brief with a reason and the sick notice with an empty reason. Both should remain in **Decided**. Verify the optional reason appears only where supplied.
- Open the leave request in both profiles before either reviewer submits. Check the private file. Submit two confirmations without refreshing the second profile. Expect one saved decision, and an already-decided message with refreshed details for the other reviewer. Confirm only the first reviewer's decision is stored.
- Copy the preview and download URLs. In a signed-out profile, open the inbox and both file URLs. Expect sign-in and no file bytes. Repeat with an inactive or disallowed account and verify it cannot retrieve them. A bare public Storage URL must also fail.
- At mobile width, open a request and use **Back to requests**. Check the tab and request-type filters, an empty result, and keyboard focus. Confirm that the empty inbox still shows all three tabs and the request-type filter.

## Connect setup and development checks

1. Apply migrations in filename order. Connect requires the staff memberships migration, `20261106000000_staff_memberships.sql`. Apply [the Connect migration](supabase/migrations/20261106000500_connect.sql) after the existing migrations. It adds the private conversation model, seeds EBA General, and enables Postgres Changes for messages.
2. In the development Supabase project's **Settings → API Keys**, copy a server-only secret key to `SUPABASE_SECRET_KEY` in `.env.local`. Keep the existing URL and publishable key. Never give this key a `NEXT_PUBLIC_` prefix. The server uses it only to record a successful authorized sign-in. All chat reads, writes, and subscriptions use the signed-in user's permissions.
3. Restart the app. Sign out and sign in again with the existing development CEO and Admin accounts in separate browser profiles. Open [Connect](http://localhost:3000/dashboard/connect). Verify EBA General opens, both accounts appear in Members after their authorized sign-in, and a provisioned account stays hidden until its first authorized Hub sign-in.
4. Send a message from each profile and confirm it appears in the other without a manual refresh. Refresh both pages to check persistence. Open the other person's chat from their avatar or Members in both profiles and compare the `chat` ID in the URL. Repeat with a new pair opening the conversation at the same time. Send a private test message and verify it stays out of General.
5. Use a third joined development CEO or Admin to open the copied DM URL and `/dashboard/connect/events?chat=<DM_ID>`. Expect an unavailable conversation and HTTP 404, respectively. Try a signed-out session as well. Inactivate a development member and verify that a fresh page load denies access and that the existing stream receives no further messages.
6. On mobile, use **Back to conversations** and select another chat. To check a failed send, open a DM, inactivate the recipient in the development database, then submit from the still-open chat. Expect a failure message with the typed text preserved.

## Connect Part 2 setup and verification

Apply the existing migrations in filename order through `20261106000500_connect.sql`, then apply [Connect notifications, read receipts, and media](supabase/migrations/20261106000600_connect_notifications_media.sql). The migration also depends on the Approvals migrations. Keep the existing Connect environment settings. It adds the private `connect-voice` bucket and publishes notification changes alongside Connect messages. No additional npm dependencies are required.

Use the development CEO and Admin accounts in separate browser profiles. Enable microphone permission on localhost or HTTPS. Voice notes are capped at 30 seconds and 750 KB. Keep the files and requests used for this check in development.

1. Send a DM from CEO to Admin. Confirm only Admin receives the alert and the DM unread count increases. Mark the alert read from the bell and confirm the DM remains unread. Open the DM and verify its count clears. Send another message with the DM closed, then open it directly and verify the associated alert also clears.
2. Send a General message. Confirm the sender receives no alert and other eligible, signed-in members receive one. Compare the bell and Overview counts after refresh. Use a third development account to verify it receives General alerts but never a DM alert for the other two.
3. After applying the migration, run the following as a development project administrator in SQL Editor. This inserts a Pending request through the same database trigger a future submission uses. Confirm both active reviewers receive a generic approval alert and its link opens that request.

   ```sql
   insert into public.approval_requests
     (title, request_type, department, requester_name, message)
   values
     ('DEV — Connect notification check', 'website', 'Development',
      'Development fixture', 'Verify both reviewers get the same Pending alert.')
   returning id;
   ```

4. Record, stop, preview, discard, then record and send a voice note in a DM. Test playback and download as the other participant and verify the same URL fails as a nonparticipant. Repeat recording with permission denied. Send a sticker in General and in the DM, and confirm each appears only in its intended chat.
5. Verify **Mark read** and **Mark all as read**, empty zero counts, private attachment access after sign-out or deactivation, and that neither role has notification opt-out controls. Try a failed send and retry with the same draft to check that a successful retry produces one message and one alert per recipient.

Notifications are generated for new events after the migration. Existing messages remain visible and may count as unread until the chat is read. The bell displays the latest 25 alerts while the unread count and Mark all action cover the entire inbox.

### Connect attachments

Apply [the attachment migration](supabase/migrations/20261106000700_connect_attachments.sql) after `20261106000600_connect_notifications_media.sql`. It adds the private `connect-attachments` bucket and attachment metadata. Reuse the existing server-only `SUPABASE_SECRET_KEY` for validated uploads. Downloads and previews use the signed-in user's access.

In separate development browser profiles, send a JPEG, PNG, or WebP in General and a PDF in a CEO/Admin DM. The picker accepts files up to 4 MB. Verify the draft waits for **Send**, the progress indicator updates, the photo enlarges, and the PDF downloads with its original filename. Refresh both sessions and reopen older history to verify the files persist. Copy the DM file link and open it with a third active nonparticipant. Expect 404. Repeat a failed upload with the original draft to verify its caption survives and the retry sends once.

### Connect message controls and mentions

Apply [the message controls migration](supabase/migrations/20261106000800_connect_message_controls.sql) after `20261106000700_connect_attachments.sql`. With two development accounts, edit a sent text message and delete a sent message. Verify the other participant sees the edit and deletion, and cannot edit the sender's message. In General, type `@`, select the other account, and send. Verify the bell shows a mention alert. Repeat in a DM and confirm a nonparticipant receives no alert. Voice notes have playback controls only. Browsers still need access to the audio bytes for playback.

## Weekly Employee Recognition

The workspace migrations do not define recognition objects before this change. Before applying [the recognition migration](supabase/migrations/20261106000900_weekly_recognition.sql), run the following read-only check on the target project. If it finds existing objects, inspect their columns, policies, and RPC signatures before applying the migration. Reuse compatible objects and reconcile differences first.

```sql
select to_regclass('public.weekly_recognition') as recognition_table;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('weekly_recognition_candidates', 'publish_weekly_recognition')
  and n.nspname in ('public', 'eba_private');
```

Apply in filename order after the current Connect migrations. Recognition uses the existing staff memberships and the active Hub predicate from `20261106000600_connect_notifications_media.sql`. Use a disposable development project and create a confirmed `eba-recognition-test@enibrand.com` user in Supabase Auth. In SQL Editor, link that user as an active staff member. This makes the person eligible for recognition without enabling staff dashboard access.

```sql
insert into public.staff_memberships (user_id, role, status)
select id, 'staff', 'active' from auth.users
where email = 'eba-recognition-test@enibrand.com';
```

### Evidence-based reviews

Apply [the evidence and reviews migration](supabase/migrations/20261106001000_recognition_evidence_reviews.sql) after `20261106000900_weekly_recognition.sql`. It preserves historical awards and replaces the implementation behind the existing publish RPC. Run [the rollback-only database check](supabase/checks/recognition_evidence_reviews.sql) in development SQL Editor with the three development accounts above. It verifies independent review privacy, revision rules, one-review and disagreement denials, direct CEO RPC denial, Admin publication, and the one-award rule.

For browser testing, add one development nomination to an unpublished week. Use the current week to test the Overview card, or replace the date expression with a previous Monday if this week already has a winner.

```sql
insert into public.weekly_recognition_nominations
  (week_start, nominee_id, what_they_did, who_benefited, what_changed, evidence_url)
select date_trunc('week', now() at time zone 'Africa/Lagos')::date, id,
  'DEV: created a reusable delivery checklist',
  'DEV: the delivery team',
  'DEV: reduced missed handoffs during a trial',
  null
from auth.users where email = 'eba-recognition-test@enibrand.com';
```

1. In separate CEO and Admin browser profiles, open **Insights** for the same week. Submit the CEO review first and confirm the Admin cannot see the choice or assessments. Confirm neither profile can publish.
2. Submit **No award this week** as Admin. Reload the week in both profiles. Confirm both reviews are visible, the status says the reviewers haven’t agreed, and publishing is unavailable.
3. Revise the Admin review to match the CEO nominee. Reload both profiles and confirm **Ready to publish** appears, with **Publish Winner** available only to Admin. Enter a short public reason and confirm.
4. Confirm both roles see the same saved winner and reason in Insights and, for the current week, Overview. Assessments appear only in Insights. Try editing a review in a stale tab and confirm the published week rejects it.

## Client Directory development setup

1. Run [the read-only schema preflight](supabase/checks/client_directory_preflight.sql) in the target Supabase project's SQL Editor. The existing migrations contain no equivalent client schema. If the preflight finds an existing directory or contact schema, inspect it before applying the migration so compatible records and policies can be reused.
2. Apply [the Client Directory migration](supabase/migrations/20261106001100_client_directory.sql) after `20261106001000_recognition_evidence_reviews.sql`. It reuses the active Hub access predicate from `20261106000600_connect_notifications_media.sql`. No new packages or environment variables are needed.
3. Sign in as Admin and open **Clients**. On an empty database, check **No clients added yet**. Add a disposable client and verify blank names and invalid email or phone entries are rejected. Save valid data and edit the contact and internal notes.
4. Sign in as CEO in a separate browser profile. Search for the client by organization and primary contact, then open the same saved record. Check that an unmatched query displays **No clients match your search**. Open the new-client URL directly and append `?edit=1` to the detail URL. The CEO should remain in the read-only flow.
5. With the development CEO's user-scoped Supabase session, attempt an insert and update directly against `client_directory`. Expect an RLS error for insert and no updated rows for update. Repeat as Admin to confirm writes succeed. Signed-out and inactive accounts must have no access to records. The client portal does not grant access to this internal directory.

## Client Portal development setup

1. Run the [read-only portal preflight](supabase/checks/client_portal_preflight.sql) against the target project. The local migrations contain the Client Directory and submitted Department Plans, with no equivalent portal schema. Inspect any existing portal objects or broad Storage policies before applying changes.
2. Apply [the portal migration](supabase/migrations/20261106001200_client_portal.sql) after `20261106001100_client_directory.sql`. No new dependencies or environment variables are needed.
3. In development Supabase Auth, create two verified password accounts with distinct disposable emails. Keep them out of `staff_memberships`. Provision their credentials out of band. This milestone uses an existing verified Auth account for redemption, with no signup or email delivery from the portal. Create two disposable directory entries, one for each account.
4. As Admin, open each client detail page and create an invitation for its account. Copy the 48-hour links and use separate browser profiles to redeem them. The token travels in a URL fragment and is hashed before the database call. Do not paste tokens into logs, issue trackers, or server URLs.
5. On Client A's detail page, share a submitted Department Plan using a client-facing title and description, and upload a small PDF, JPEG, or PNG up to 750 KB. Sign in as Client A and open both shares. Copy the project detail and file download URLs. Paste both as Client B and expect 404. Confirm the project shows only the client-facing description and the file downloads privately.
6. With Client A still signed in, revoke access as Admin. Reload the portal and the copied file URL. The page should return to client sign-in and the download should return 404. Verify that a revoked or expired invite cannot be accepted and that retrying a used link does not create a second grant. **Grant access again** restores a previously invited, verified account. A new account must redeem an invitation.
7. As CEO, confirm invitation status and audit history are visible and mutation controls are absent. Call `manage_client_portal` with the CEO's user-scoped session and verify it returns a permission error. While signed in as either client, visit `/dashboard` in a browser profile with no staff session and verify it redirects to staff sign-in.
