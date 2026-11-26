# Google Calendar / Meet organizer authorization

**Part 2 update:** The authorization milestone below is preserved. Actual Google
event/Meet creation and automatic-recording configuration are now added by
`docs/calendar-part2.md`, with a separate migration and worker setup. Connection
status remains separate from per-meeting readiness, and the existing encrypted
credential accessor is reused. No additional OAuth scopes are required.

This change connects one server-configured organizer account. It does not change
Supabase staff login, create meetings, configure recording on any space, schedule
reminders, or retrieve recordings. Existing Calendar Part 1 tables and behavior are
preserved; no parallel meeting or event model is introduced.

## Calendar Part 1 compatibility

Read alongside `docs/calendar-part1.md`. Organizer authorization is confined to
Settings and the server-only Google connection/state tables. It does not gate
Calendar scheduling on Google configuration or alter Lagos views, recurrence,
one-occurrence/remaining-series edits, cancellations, organizer permissions,
attendee visibility, department selection, reminder invalidation or Overview.

The existing `calendar_series` provider fields (`provider`,
`provider_calendar_id`, `provider_series_id`) and `calendar_occurrences` fields
(`provider`, `provider_calendar_id`, `provider_event_id`, `provider_etag`,
`join_url`, `sync_status`, `sync_error`, `synced_at`) are the integration points
for subsequent Google event creation/synchronization. Reuse them rather than
introducing another meeting store. This authorization migration neither alters
those tables nor writes any of those fields.

The Settings **Connected** state means organizer authorization and encrypted
credential storage succeeded and the status check verified current access.
`meet_supported` describes primary-calendar conferencing capability only. Neither
means a particular meeting has a Google event or a working Meet join URL.
Calendar cards and create/detail dialogs continue to display **Meet setup pending**.
Only a later implementation that actually creates and verifies a meeting's Google
Meet conference may change that occurrence's readiness. Connecting, reconnecting
or disconnecting the organizer must not mark existing occurrences as synced or ready.

Compatibility verification: `npm run test:calendar` covers the existing seven
date/recurrence/HTTP-contract cases plus a rendered Calendar/dialog/Overview
regression. Hosted recurrence, RLS and remaining-series transaction checks remain
in the existing post-migration SQL and live browser tests; they were not replaced
with mocked assertions or claimed as live passes.

## Prerequisites and installation (operator steps)

1. Use a supported Node version for this Next.js project. Run in the project root:

   ```powershell
   npm install google-auth-library@^10.5.0
   ```

   This is Google's maintained Node authentication library. The install updates
   package.json and package-lock.json. It has deliberately **not** been installed
   or added to the lockfile by this change. The server adapter has an explicit
   structural interface so TypeScript checks can run before installation; the
   production build and live OAuth require the real package. Do not deploy until
   the install and production build succeed. No JWT decoding fallback exists.

2. In Google Cloud, enable **Google Calendar API** and **Google Meet REST API** in
   the OAuth client's project. Configure a **Web application** OAuth client with
   the exact authorized redirect URI:
   `http://localhost:3000/api/google/callback`.
   Production needs its own registered HTTPS callback at the same exact path and
   the corresponding server environment value. No trailing slash or wildcard.
3. Configure the consent screen/data access with the scopes below. An internal
   Workspace app is appropriate if all authorization is internal to the Workspace
   organization; otherwise configure allowed test users during testing and satisfy
   Google's consent/publishing/verification requirements before production.
   Workspace app access controls must allow the app and requested permissions.
   External apps left in Testing can receive refresh tokens with limited lifetimes;
   use a suitable production consent configuration for persistent offline access.
4. Keep the existing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
   and GOOGLE_ORGANIZER_EMAIL server-only. The organizer must match Google's
   **verified email exactly**, including case. The current intended organizer is
   `admin@enibrand.com`. No hosted-domain or email hint authorizes an account.
5. Add **GOOGLE_TOKEN_ENCRYPTION_KEY** to `.env.local` and the production server's
   secret manager. It must be canonical base64 for **32 random bytes**, separate
   from the database and Supabase keys. Generate it directly into a local ignored
   file without printing it (run once; it refuses to replace an existing key):

   ```powershell
   @'
   const fs = require("node:fs"), crypto = require("node:crypto");
   const file = ".env.local";
   const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
   if (/^[ \t]*GOOGLE_TOKEN_ENCRYPTION_KEY[ \t]*=/m.test(existing)) {
     throw Error("Encryption key already configured");
   }
   fs.appendFileSync(file, "\nGOOGLE_TOKEN_ENCRYPTION_KEY=" + crypto.randomBytes(32).toString("base64") + "\n");
   '@ | node
   ```

   Store a secure backup in your secret manager. Every server instance must use
   the same key. Do not put it in SQL, browser code, NEXT_PUBLIC variables, logs,
   a screenshot, or version control. Changing the key without a migration makes
   saved credentials unreadable. For this first version: disconnect using the old
   key, rotate it, restart all instances, then reconnect. If the old key is lost,
   disconnect still clears local storage, but remote revocation cannot be
   confirmed; revoke the app manually from the organizer's Google account.
6. The existing server Supabase key (`SUPABASE_SECRET_KEY`, or the legacy
   `SUPABASE_SERVICE_ROLE_KEY`) is required. Browser publishable keys cannot read
   or write integration credentials. `.env.example` contains placeholders only.

## Database preflight and forward migration

Run `supabase/checks/google_organizer_preflight.sql` in the Supabase SQL editor
as postgres. It is **read-only**, ends with ROLLBACK, and never reads token values.
It checks existing staff/session columns, active role counts, server privileges,
and any existing Google table/function grants. Before migration the Google tables
and function should be absent; if they already exist, investigate before applying
this non-idempotent forward migration. The three `server_can_*` flags must be true.

Apply exactly this forward migration using your normal migration workflow:

`supabase/migrations/20261116143000_google_organizer_authorization.sql`

It depends on the existing staff membership migration, not Calendar Part 1. It
creates a singleton connection, expiring OAuth states, and a service-role-only
transactional authorization RPC. It does not touch staff credentials, existing
meetings, reminders, or recordings. Do not run a generic push that unintentionally
applies other outstanding migrations. No hosted migration was applied here.

Run the read-only preflight again. Both tables must have RLS enabled, **no browser
grants and no RLS policies**; anon/authenticated execute flags on the RPC must be
false and server execute true. The function is SECURITY INVOKER. The service role
must retain its existing ability to check live auth.sessions, auth.users and staff
memberships. No new browser privilege should be added to solve an access error.

Optional post-migration database exercise:
`supabase/checks/google_organizer_verification.sql`. Log in once as the test Admin
and CEO first. This checks real service-role privileges, CEO refusal, wrong browser
binding, replay, and disconnect invalidation inside a transaction that rolls back.
Use staging while idle: it briefly locks the singleton. It creates no Google
resources and is **not** the read-only preflight.

## Exact requested OAuth scopes

| Scope | Purpose |
| --- | --- |
| `openid` | Google-signed organizer identity token |
| `email` | Verified organizer email |
| `https://www.googleapis.com/auth/calendar.events.owned` | Future management of events on organizer-owned calendars |
| `https://www.googleapis.com/auth/calendar.calendars.readonly` | Read primary calendar metadata to check allowed conference solution types |
| `https://www.googleapis.com/auth/meetings.space.settings` | Future automatic-artifact settings on Calendar-created Meet spaces |

No Drive scope, recording retrieval scope, broad `calendar` scope, or
`meetings.space.created` scope is requested. The latter does not cover configuring
spaces created by Calendar. All required permissions are checked at code exchange
and again using Google tokeninfo on the refreshed access token. Declining a
required scope does not create a connected state.

Official sources checked for this implementation:

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google-maintained Node library](https://github.com/googleapis/google-auth-library-nodejs)
- [Calendar scope list](https://developers.google.com/workspace/calendar/api/auth)
- [Calendars.get scope requirements](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get)
- [Meet settings for Calendar-created spaces](https://developers.google.com/workspace/meet/api/guides/meeting-spaces-configuration)
- [Google recording requirements](https://support.google.com/meet/answer/9308681?hl=en)

The current Business Standard subscription and enabled recording permission were
provided by the operator; this authorization setup does not verify licensing or
Workspace administrative recording policy. It reads only the primary calendar's
`conferenceProperties.allowedConferenceSolutionTypes` and reports support only
when `hangoutsMeet` is present. A missing/false value is shown as unavailable,
not as successful recording readiness. According to current Google requirements,
automatic recording does not start until an eligible host/co-host joins on the
web. Authorization, licensing and enabled policy do **not** guarantee a recording.
No meeting/recording test action is implemented or run in this scope.

## Security and lifecycle

- Active CEO/Admin staff still sign in with Supabase username/password. Settings
  uses the existing dashboard shell and staff gate. CEOs see status only. Every
  connect/disconnect request checks active Admin membership and same-origin POST.
  Callbacks independently repeat active Admin authorization.
- OAuth uses authorization code, offline access, explicit consent/account choice,
  S256 PKCE and an OIDC nonce. The maintained library validates Google's ID token
  signature, issuer, audience and expiry; the app checks nonce, verified email,
  exact configured account and Google subject. No identity token is decoded as a
  substitute for verification.
- A 256-bit state is stored only as a SHA-256 hash, alongside a hash of a separate
  HttpOnly/SameSite=Lax browser cookie, the verified Supabase session_id and Admin
  ID. States expire after ten minutes and are atomically consumed once, including
  consent denial. The database checks the live session and active Admin again.
  Starting a newer authorization invalidates the previous pending attempt.
- AES-256-GCM encrypts refresh tokens and PKCE verifiers with fresh 96-bit IVs,
  authenticated version/purpose/account context, and an external 256-bit key.
  The singleton prevents multiple organizer connections. An environment organizer
  change disables use of a previously stored different account.
- Successful callback validates all scopes, identity and offline refresh, checks
  calendar conferencing, then atomically saves encrypted credentials. Failure
  never enables a fresh connection. Reconnect preserves an old refresh token only
  for the same enabled organizer subject and email if Google omits a new one;
  that fallback is refreshed and scope-checked before saving. Failed reconnect
  leaves an existing valid connection intact.
- Server refresh keeps tokens off the browser. Invalid-grant errors disable local
  credentials and show reconnect required. Network/API failures show unverified
  status rather than claiming current access. Status checks are explicit on page
  load / Refresh status, not background scheduling. Last checked time is Lagos.
- Disconnect commits local disablement, removes the encrypted refresh token and
  pending OAuth states, and advances a generation before contacting Google's
  revocation endpoint. A stale callback/refresh cannot re-enable the connection.
  Revocation is a server-side POST body, not a token-bearing URL. A failed remote
  revoke is displayed honestly; manually remove the app in Google Account →
  Security → Third-party connections if needed.
- No tokens/provider payloads are returned to the browser or logged. Redirects
  carry only allowlisted outcome names; a URL success flag never establishes the
  Connected UI. All Google endpoints send private/no-store and no-referrer headers.
  Next incoming logging excludes the OAuth callback query. Configure deployment
  proxies/APM/access logs to redact or omit callback query strings and sensitive
  authorization headers/bodies too; application configuration cannot control
  infrastructure logs. Keep library debug logging off. Do not save OAuth HARs.

## Verification and exact operator acceptance tests

Before live testing, complete installation, encryption key, consent/API setup and
migration above, restart the app, and run:

```powershell
npm run test:google
npm run lint
npx tsc --noEmit
npm run build
```

The local test suite exercises real server functions, encryption and HTTP routes
with mocked Supabase/Google responses. It is **not** evidence of live Google
consent, real JWT signature verification, hosted RLS, API enablement, licensing or
remote revocation. The optional SQL script tests the actual migrated database.

Use separate browser profiles for your **active Admin and CEO test accounts**.
Use the organizer Google account for the OAuth consent window. Do not paste
passwords, tokens, codes, or callback URLs into chat or test reports.

1. **Connect:** As Admin, open `/dashboard/settings` at `http://localhost:3000`.
   Status starts Checking, then Disconnected. Click **Connect organizer**, select
   the configured organizer and grant all requested scopes. You must return via
   `/api/google/callback` to Settings. Only after encrypted save and the status
   check should Connected appear with the exact email, verification time and
   primary-calendar Meet support. In SQL, inspect only `enabled`, `status`, email,
   and `refresh_ciphertext is not null`; never select the ciphertext itself.
   No Google event or recording should have been created.
2. **Account mismatch:** Prefer starting while disconnected, click Connect and
   authorize a different Google account permitted by the consent screen. Expect
   the account-mismatch message and no connected credentials. If reconnecting an
   existing connection, the original organizer remains unchanged. If Google's own
   consent/test-user policy blocks that account first, record that separately;
   it does not exercise EBA Hub's identity-mismatch check.
3. **Reconnect:** Connect correctly, note the email, then click **Reconnect
   organizer** and consent again as the same organizer. Confirm Connected and a
   new verification time. Decline once to confirm the previous valid connection
   remains. Start two attempts in separate tabs; only the newest may complete.
   Wait more than ten minutes on another attempt; returning must require retry.
   Replaying a previously completed callback must not save credentials again.
   Do not copy callback URLs to logs or screenshots while doing these checks.
4. **CEO denial:** In the CEO profile, Settings must show the same status but no
   Connect/Reconnect/Disconnect controls. In that profile's console, run only:

   ```javascript
   await fetch('/api/google/connect', {method:'POST'}).then(r => r.status) // 403
   await fetch('/api/google/disconnect', {method:'POST'}).then(r => r.status) // 403
   ```

   Visit `/api/google/callback?state=invalid&code=invalid` as CEO: expect the
   forbidden message, no exchange, no credential change. As Admin, start consent,
   then sign out and back in (new Supabase session) before finishing; it must fail.
   Also deactivate/demote that test Admin before finishing a new flow; the callback
   must refuse it. Restore test membership afterward using your normal admin tool.
5. **Disconnect:** As Admin, click Disconnect. The status must become Disconnected
   and local `enabled=false` / refresh ciphertext absent before remote revocation.
   CEO Refresh status must also show Disconnected. Confirm the Google account's
   third-party permissions are removed or explicitly reported as not confirmed.
   For the failure case, block only `oauth2.googleapis.com/revoke` on the **server**
   during a test disconnect: local disablement must still succeed and the warning
   must persist. Browser network blocking does not simulate server revocation.
   Manually remove the Google app afterward if revocation was not confirmed.
6. **Revoked access:** Reconnect, then remove the app in the organizer's Google
   Account. Refresh status in EBA Hub: expect Reconnect required after Google's
   invalid-grant response. No token details should appear in response JSON, HTML,
   client bundles, application logs or console output.

Live Google acceptance and hosted migration verification remain outstanding.
Record their results after completing the operator steps.

### Implementation check results

| Check | Result |
| --- | --- |
| `npm run test:google` | 16 passed; mocked Google/Supabase, real encryption/server/route code |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed using the explicit library adapter interface |
| `npm run build` | Blocked: `google-auth-library` is not installed; no other reported compile errors after removing incompatible route runtime declarations |
| `npm run build -- --webpack` | Also blocked by the missing Google library |
| Rendered Settings card | Actual React component and mocked status at 1280×900 and 390×844; disconnected → refresh → connected and Admin reconnect controls; CEO has zero mutation controls; no horizontal overflow or runtime errors |
| Browser scope | Isolated UI fixture, not a signed-in live app |
| UI review | No blocking findings; informational color-token advice only, matching the existing dashboard palette |
| Hosted SQL / Google OAuth | Not run; operator migration/install/consent still required |

The Settings card follows the existing dashboard's forest/ivory styling and native
form controls. Existing design metadata informed its grouping; no catalog
component or dependency was installed. Screenshots are isolated UI fixtures with
`organizer@example.com`, not proof of a real organizer connection.
