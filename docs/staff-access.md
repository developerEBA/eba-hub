# Settings → Staff access

## Directory loading repair — November 19, 2026

The actual service-role directory request was reproduced read-only and returned
HTTP 400, SQLSTATE **42702** (`target` is ambiguous). The directory audit projection
used `select ... target ...` while the PL/pgSQL function also declares a local
`target uuid` variable. PostgreSQL rejected that branch even with an empty audit
table. The original 27 checks inspected installation/grants/definitions, not a real
execution of this branch; PASS did not establish runtime correctness.

Live zero-row requests confirmed SELECT access to every referenced public column
in all six directory tables. The real RPC passed its caller/management check before
failing in the projection, establishing the referenced Auth identity fields were
readable too. RPC argument names were checked as `p_action`, `p_actor`, `p_data`.
Required server URL/key and application-origin presence were checked as booleans,
without printing values. Directory GET does not depend on the application-origin
setting (only mutations and invitation links do). Successful response parsing now
checks the directory's arrays and truncation flag before the UI receives it.

Apply only **`supabase/migrations/20261119160000_staff_directory_target_ambiguity.sql`**
after the already-applied staff-access migration. Do not rerun or edit that older
migration. The new repair reads the installed definition and replaces exactly the
known audit projection with qualified `audit.*` fields, preserving installed logic,
SECURITY INVOKER, all authorization, grants and role gates. It fails safely if the
expected source projection is absent, rather than overwriting an unknown function.

Then run **`supabase/checks/staff_directory_verification.sql`** as postgres. This is
one focused read-only transaction, switches locally to service_role and executes
the real directory branch for a real eligible manager. It returns named PASS/FAIL
flags only, including response shape and every referenced public/Auth column grant;
no personal records or credentials are returned. Before the repair it intentionally
reproduces 42702 instead of returning a misleading PASS.

Restart/reload the app if necessary, open Settings → Staff access and choose Retry.
`node scripts/diagnose-staff-directory.cjs` is an optional server-side read-only
probe: it prints configuration-presence flags, zero-row column permission results
and classified RPC SQLSTATE only. It never prints identities, environment values,
arguments, records or provider error payloads. It uses existing server credentials;
do not copy its environment or run it in a browser. Server runtime failures now
log only fixed event/action/category fields and a sanitized error code. UI failures
say the directory could not load and offer Retry, rather than assuming missing setup.

Live verification so far reproduced the original failure and established the
permissions/configuration checks. No hosted repair was applied, so
successful hosted execution after the migration remains the operator's check.
Offline tests cover sanitized diagnostics, actual RPC adapter arguments and response
parsing, the qualified forward projection and existing authorization boundaries.

Settings now contains a staff directory, invitations, ordinary assignment changes,
activation/deactivation and the latest 50 access audit entries. The Google card,
username/password sign-in, Client Portal and controlled CEO/Admin provisioning
remain separate. There is no new sidebar item, public sign-up, mailbox creation,
Zoho integration, or Google-authorized email sending.

## Setup and combined diagnostic

No dependencies were installed, no hosted migration was applied, no real invite
was generated and no account was changed during implementation. The Supabase CLI
is absent locally; no CLI was installed. This forward SQL is supplied for the
operator's existing migration process.

1. Prerequisites: existing staff memberships, Connect profiles, Client Portal
   access and Calendar Part 1 department assignments. Use the intended project
   and your normal backup/review procedure.
2. Run `supabase/checks/staff_access_diagnostic.sql` as postgres. It is one
   read-only transaction ending in ROLLBACK with **one result table**, containing
   named PASS/FAIL rows. New-object checks fail before first application. It
   returns no names, email addresses, passwords, tokens, credentials or invite
   hashes. Function-body checks establish installed definitions, not live tests.
3. Apply `supabase/migrations/20261119130000_staff_access.sql` once, then rerun
   the same diagnostic. It creates no memberships, assignments or Auth users.
   Existing `ceo`, `admin`, `staff` roles are preserved; `hod` is added by the
   forward role constraint. Only real invitations/management actions create
   assignments. Existing multi-department assignments are displayed unchanged;
   saving an ordinary assignment explicitly replaces it with the selected department.
4. Configure server-only `EBA_APP_URL` to the exact origin, e.g.
   `http://localhost:3000` for development or your HTTPS production origin. No
   paths, credentials or query strings. It is used for canonical links and
   mutation-origin validation. Existing Supabase public URL/publishable key and
   server-only secret/service key remain required. No extra encryption key or
   dependency is needed. `.env.example` contains placeholders only.
5. Keep Supabase public signup disabled in Auth settings; privileged admin
   `generateLink` provisions invited ordinary accounts without adding a public
   signup endpoint. Confirm email/password and invite/magic-link verification are
   supported by the project's Auth settings and that its OTP lifetime is suitable.
   Staff invite records last 48 hours; the Auth verification token can expire sooner.
6. Restart the app. Active verified CEO/Admin accounts can load Settings → Staff
   access. CEO cannot mutate. A setup failure is displayed honestly with Refresh.

## Permissions and data

Database `staff_access_control` is service-role-only, SECURITY INVOKER, with an
empty search path and explicit minimum table grants. It rechecks verified active
management membership, company domain, deleted/banned account status and Admin
write authority. Private invitation/profile/audit tables have RLS and no anon or
authenticated grants. HTTP authorization and same-origin checks precede all writes.
No editable user metadata participates in authorization.

Admin assignment choices are only Employee (`staff`) and HOD (`hod`). All CEO/Admin
targets are immutable here, including self changes and the last active Admin.
Privileged provisioning remains the existing controlled database/Auth setup.
Self and last-Admin checks are explicit even though the broader privileged-target
restriction also blocks those changes. Reactivation changes only membership status;
it preserves the existing permitted role and department. It does not unban an Auth
account or change security settings. Invalid/unverified/deleted/banned identities
cannot be activated through this feature.

Management transactions use a common advisory transaction lock, target row locks
and expected `access_version` for concurrent assignment/status edits. A unique
partial index permits one pending invitation per normalized email. Supabase owns
Auth identity uniqueness; the application does not insert into `auth.users`.
Existing staff memberships and any Client Portal-bound Auth identity cannot be
invited again. Reactivate existing ordinary memberships instead. Names come from
management profiles or existing Connect names; no fake directory records are seeded.
The directory loads the first 500 memberships and latest 500 invites; filters are
explicitly applied to that loaded set, and truncation is shown.

Audit records contain actor, action, target company email, timestamp and explicit
status/assignment changes. Passwords, invitation tokens, Auth token hashes and
credentials never enter audit payloads. Active CEO/Admin management can read audit
through the checked directory endpoint; browsers cannot read the underlying tables.

## Invitations and delivery limitations

No verified invitation sender or SMTP configuration exists in repository settings.
Hosted Auth SMTP status was not inspected or assumed. This feature intentionally
uses **copy-only delivery**. Supabase `auth.admin.generateLink` generates an invite
for a new ordinary account or a magic link for an existing unassigned Auth identity;
it does **not send email**. No other email integration is claimed or enabled.
If deploying a real sender later, it must privately deliver the same recipient-bound
link and independently report delivery success/failure. Google Calendar consent
does not supply mail permissions. Zoho remains paused.

Admin must copy the returned link immediately and privately deliver it to the
intended existing company email owner. The link is a bearer credential, like an
email invitation; do not post it in shared chat or give it to someone else. With
copy-only delivery, the app cannot independently prove that an administrator's
chosen delivery channel reaches that mailbox. Supabase verifies the signed Auth
identity bound to the invite; this is not a claim that an email was delivered.

The application generates 32 random bytes and stores only SHA-256 of its token.
Supabase separately owns the Auth OTP hash. Neither plaintext application tokens
nor provider OTP hashes are stored in application invitation/audit records. The
copy link carries both verification values in its URL fragment, never a query
string. `/staff/invitation` removes the fragment immediately and keeps values only
in a component ref, not local/session storage. The page has no-referrer/noindex
metadata. API responses are no-store, and failures do not return provider payloads.
Links cannot be recovered after leaving the page: revoke and create a new one.

Acceptance is an explicit POST using an isolated `eba-staff-invitation` HttpOnly
cookie. It does not overwrite staff or client session cookies. The server checks
the live invitation, verifies Supabase OTP, calls Auth `getUser`, and rechecks the
bound user ID, exact normalized company email, confirmed email, bans/deletion,
current inviter authority, expiration, revocation and existing memberships. A new
account needs a 12–128 character password. Identity binding is checked before
password changes; acceptance checks it again in the final locked transaction.
Invitation consumption and membership/profile/department insertion are atomic.
The isolated Auth session is signed out/cleared after the attempt.

Auth API operations and Postgres are not one distributed transaction. If link
generation, binding, password update or acceptance fails partway, an unassigned or
verified Auth account can remain without Hub membership. It is never deleted to
hide that failure. Revoke a pending invite and regenerate for that existing
unassigned account. If an OTP was consumed before a temporary failure, the link
cannot be replayed: an Admin must issue a fresh one. Revocation prevents membership
acceptance; it is not a claim that Supabase's separate OTP was invalidated. A race
after identity verification may update an Auth password before acceptance is
revoked, but it never bypasses the final membership transaction.

## Rollout, deactivation and departments

Membership activation is not dashboard release. `getStaffRole`, dashboard access,
Connect SQL gates, calendar/games eligibility and other existing rollout checks
continue to permit active CEO/Admin only. Employee/HOD directory rows explicitly
say Dashboard not released, including active memberships. Acceptance ends with
that explanation and never redirects an Employee/HOD into a dashboard.

Deactivation changes membership status and increments its revision. It does not
delete Auth users, messages, submitted plans, approvals, project ownership, or audit
history. Protected server requests recheck active membership, and existing Connect/
storage RLS repeats the active rollout gate. Existing media uses protected download
handlers/RLS, not a new public or signed URL flow. A department change only updates
the real assignment table; it adds no chat memberships, historical private resource
permissions or project ownership. Private department groups remain pending. Calendar
Part 1 snapshots existing eligible attendees rather than retroactively subscribing
new ordinary department members.

Supabase's supported Admin `signOut(jwt, scope)` requires a valid target session
JWT, not a user ID. Staff management never collects or stores other people's JWTs,
and no supported user-ID global-revocation operation is available in the installed
SDK. Therefore deactivation **does not claim to revoke all Auth sessions** or edit
`auth.sessions`/refresh tokens directly. New protected requests are denied by
membership checks even while an Auth JWT remains cryptographically valid. Already
downloaded content cannot be recalled. Existing realtime streams have their current
short lifetime (Connect ends at 50 seconds) and RLS; already rendered content may
remain visible. The isolated invitation session can be revoked through the normal
supported sign-out because that session is available to the server. Review Auth
JWT lifetime and independent session policy in the normal controlled setup.

References checked November 19, 2026:
- https://supabase.com/docs/reference/javascript/auth-admin-generatelink
- https://supabase.com/docs/reference/javascript/auth-admin-signout
- https://supabase.com/docs/guides/auth/sessions

## Verification and exact disposable-account acceptance

Offline: `npm run test:staff-access`, `npm run lint`, `npx tsc --noEmit`,
`npm run build -- --webpack`, plus existing Calendar/Google/import/reminder/rendering
regressions. Tests exercise actual validation, services and HTTP handlers with mocked
Auth/DB, injected invitation clocks and static SQL contracts. Static SQL contracts
do not establish hosted RLS, duplicate constraints or concurrent transaction behavior.

An isolated local headless Chrome fixture also exercised the actual Staff access
component with synthetic records and mocked HTTP: search, ordinary role options,
Employee/HOD dashboard-unavailable labels, safe default confirmation focus,
Tab focus trapping, confirmed deactivation, CEO read-only controls, and 390px
mobile page overflow. This is component verification, not a live signed-in
dashboard/real Auth acceptance. Existing Settings primitives were reused; the
The existing layout was used for invitation direction without installing
components or dependencies. The modal's deliberate initial focus on Keep access
is retained despite the generic autofocus review warning.

After applying the migration yourself, use a **new disposable company mailbox and
ordinary staff account**. Do not alter existing CEO/Admin test accounts.

1. As active Admin, load the real directory and use search, department and status
   filters. Check real CEO/Admin rows are view-only. As CEO, directory/audit load,
   but POST to `/dashboard/settings/staff` returns 403. Signed-out/inactive requests
   and foreign Origin writes are denied. Keep test credentials outside chat/logs.
2. Invite the disposable company address as Employee in Graphics. Confirm the
   returned message says no email sent and the invitation status is pending.
   Copy the link privately. Repeat with uppercase/whitespace and with two concurrent
   requests: only one pending invitation/account may result. External domains and
   direct `ceo`/`admin` role payloads must fail without membership writes.
3. Open the link in a disposable browser session, confirm the fragment disappears,
   choose a password if requested, and accept. Check verified Auth identity and a
   single active `staff` membership/Graphics assignment. It must say dashboard not
   released; normal Hub sign-in, direct dashboard/calendar/Connect/media access
   must remain denied. Replay the same link: acceptance must fail.
4. Create another disposable invitation and revoke it, then attempt acceptance.
   No membership may be created. For expiry use an invitation older than its real
   lifetime or an isolated test project's seeded fixture; do not change system time
   or production rows. Expiration must fail before password/membership writes.
5. Mix the application token from one disposable invitation with the Auth token
   of another. Identity verification must fail before any password or membership
   update. Never use real executive/client verification tokens for this test.
6. Edit the ordinary disposable member to HOD/Development, then deactivate through
   confirmation. Preserve their history; active protected requests stay denied.
   Reactivate: only the same permitted assignment returns, dashboard still pending.
   Reassigning a department must not add historical chat/private content access.
7. Send two updates with the same member revision concurrently. Only one succeeds;
   the second must refresh rather than overwrite it. Race revoke/accept on another
   disposable invitation: exactly one final state and at most one membership.
8. Attempt self, existing CEO, any Admin and last-active-Admin changes using direct
   HTTP payloads: all are rejected. Do not actually demote/remove executive accounts.
   Inspect audit for actor/action/target/time and absence of passwords or tokens.
9. Re-run the combined diagnostic. Separately verify Supabase Auth signup, email,
   OTP lifetime and deployment-origin settings; those cannot be proven by this SQL.

Live Auth provisioning, email ownership/delivery, hosted constraints/RLS, concurrent
transactions and signed-in browser acceptance remain operator checks until run in
that disposable environment. No live checks are claimed by mocked verification.
