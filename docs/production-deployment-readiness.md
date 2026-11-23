# EBA Hub production deployment readiness

Status reviewed: 2026-11-23. No hosted service, DNS, account, database, or job
was changed during this review.

## Current release shape

- Build command: `npm run build` runs `next build --webpack` (verified locally).
- Runtime: Next.js 16.4.5 on Node.js. Its installed package declares Node
  `>=20.9.0`; the host must provide a persistent Node runtime compatible with
  this release. There is no Dockerfile, provider config, or deployment workflow
  in this repository.
- Start command for a Node host: `npm run start`. The host should set `PORT` and
  bind the process as its platform requires. Routes use Node APIs and server
  packages; do not deploy them to an Edge-only runtime.
- The active dashboard gate (`getStaffRole`) accepts only active CEO/Admin
  memberships. Employee/HOD accounts may use the isolated account profile path,
  but cannot enter dashboard pages or APIs through the dashboard gate. This
  rollout is unchanged.
- Zoho and email integration remain paused. Staff invitations create a
  copyable link only; they do not send email.

## Production environment variables

Set these in the host's encrypted server environment, not in source control.
Only the two `NEXT_PUBLIC_` Supabase values are intentionally browser-visible.

| Name | Requirement | Production value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Required | HTTPS URL of the production Supabase project. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required | That project's publishable key. This is designed for browser use and relies on RLS for data access. |
| `SUPABASE_SECRET_KEY` | Required for server-backed management/features | Production project's server-only Supabase secret key. Never prefix it with `NEXT_PUBLIC_`. Code has a legacy `SUPABASE_SERVICE_ROLE_KEY` fallback; prefer one configured `SUPABASE_SECRET_KEY`. |
| `EBA_APP_URL` | Required for staff management mutations | Exact canonical HTTPS application origin, e.g. `https://<production-host>`; no path, query, credentials, or fragment. It is used for invitation links and same-origin checks. |
| `GOOGLE_CLIENT_ID` | Required to use the existing Google organizer connection | Existing Google OAuth Web client ID. |
| `GOOGLE_CLIENT_SECRET` | Required to use the existing Google organizer connection | Matching Google OAuth client secret, server-only. |
| `GOOGLE_REDIRECT_URI` | Required to use the existing Google organizer connection | Exact `https://<production-host>/api/google/callback`, registered as an authorized redirect URI in Google Cloud. |
| `GOOGLE_ORGANIZER_EMAIL` | Required to use the existing Google organizer connection | Exact mailbox of the already-authorized organizer account. Preserve the current authorized identity; do not change accounts as part of deployment. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Required to use the existing Google organizer connection | Canonical base64 encoding of 32 random bytes, stored only in the server secret manager. Keep the same key as existing encrypted Google credentials; changing it can make stored credentials unreadable. |
| `CALENDAR_SYNC_SECRET` | Required before enabling production calendar scheduling | Random server-only bearer secret with at least 32 characters. Configure the same value in the scheduler's secret store. Do not put it in a URL, browser variable, or log. |
| `GOOGLE_IMPORT_OWNER_EMAIL` | Optional | Leave empty unless the existing explicit, verified Admin coordinator for Google imports is configured. It must not be inferred from a domain or attendees. |
| `GOOGLE_MEET_CALL_ENDING_ENABLED` | Optional; keep `false` initially | Leave `false` until the exact organizer reauthorizes the optional Meet call-ending scope and hosted termination tests pass. `true` requests consent; it does not prove Google granted or supports the capability. |

`NODE_ENV` must be production and is normally set by the host. Do not manually
set framework-managed `PORT` unless the host requires it. No email provider
variables are required or supported for the paused Zoho/email integration.

## URL configuration to replace

The development values in `.env.example` are not production values:

- `EBA_APP_URL=http://localhost:3000` → the canonical HTTPS origin.
- `GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback` → the exact
  public HTTPS callback shown above. Register the identical URI in the Google
  OAuth client. Callback request logging is explicitly excluded in `next.config.ts`.
- Supabase Auth URL Configuration is hosted dashboard state, not committed
  configuration. Set its Site URL to the canonical HTTPS origin. Keep its
  Redirect URL allowlist restricted to exact production application URLs; add
  `https://<production-host>/staff/invitation` if any Supabase-generated action
  link is configured to return there. The current invitation code builds its
  own fragment-only link from `EBA_APP_URL` and does not pass `redirectTo`, so
  confirm the actual Supabase allowlist rather than assuming a value from code.
- Remove localhost entries from production Google/Supabase allowlists unless a
  separate, explicitly approved development project still needs them. Do not
  use broad preview wildcards for production.

The public production hostname is not present in this repository. Supabase URL
settings, Google Console callback registration, OAuth consent status, and DNS
are therefore **NOT VERIFIED**.

## Production calendar scheduling

The supported production entry point is the deployed HTTPS `POST
/api/calendar/sync` endpoint. It accepts only `Authorization: Bearer
<CALENDAR_SYNC_SECRET>` and compares the token in constant time; a staff cookie
does not authorize the job. Authenticated `GET` is also supported if a scheduler
cannot issue POST, but POST is preferred. The secret belongs in the scheduler's
secret store, never in a query string.

The endpoint exports `maxDuration = 120`, uses an approximately 85-second work
budget, and composes Google sync/import, private bell reminders, and closure
processing with durable database leases/deduplication. The existing local worker
(`npm run calendar:worker`) targets `http://localhost:3000`, rejects production,
and rejects Vercel; it is not a deployment scheduler. No cron/provider schedule
is configured in this repo.

Before enabling the schedule, the host plus external scheduler must support:

1. A Node server runtime for Next routes, with a 120-second maximum invocation
   for `/api/calendar/sync`.
2. An HTTPS request every 60 seconds, a protected secret header, and request
   timeout of at least 120 seconds.
3. Overlapping/retried requests safely. Database leases serialize occurrences;
   do not remove the durable queue or deduplication migrations.
4. Scheduler monitoring and alerts for repeated 503s or a growing failed queue.

The host and plan are unknown, so compatibility with these requirements is
**NOT VERIFIED**. Do not enable a schedule until the provider and plan are
identified and these limits are confirmed. No live jobs were processed here.

## Credential and access review

- `.env*` is ignored and `.env.local` is not tracked.
- Client Supabase setup reads only `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Privileged service helpers are
  `server-only`; `connect-enrollment.ts` is now guarded as well.
- A local production build scan found no configured server-secret values in
  `.next/static`. This is a static bundle check, not a hosted runtime audit.
- Google callback request logging is suppressed. Its response redirects contain
  only allowlisted status values. Staff-access logs use allowlisted categories
  and SQLSTATEs; calendar worker output contains aggregate counts only.
- Dashboard authorization is repeated in server handlers/RPCs; the proxy cookie
  refresh is not treated as the authorization boundary. Employee/HOD dashboards
  remain blocked. Client portal authorization uses separate client access.
- Review actual host logs, secret-manager ACLs, Supabase RLS, and production
  bundles after deployment. Those checks cannot be completed without host access.

## Live acceptance checks still required

These require a staging/production-like host, existing test accounts, and hosted
data. Do not invent identities, apply unreviewed migrations, send invitations,
or run calendar jobs during this local preparation.

- **Recognition:** distinct active CEO and Admin; each can nominate the three
  monthly categories; private reviews stay separate until both submit;
  disagreement blocks publication; Admin is denied through a direct RPC; CEO
  publishes agreed winners and No award; verify repeat publish and historical
  archive. Local database integration tests were skipped because no isolated
  local PostgreSQL/Supabase test database is configured.
- **Calendar reminders:** staging occurrence with known audience, current
  schedule revision and cancellation; verify one due delivery, deduplication,
  private bell state, retry and cancellation suppression. Do not put department
  details into a department room unless all room readers are authorized.
- **Meeting termination:** use the existing organizer account and one test Meet;
  verify scope consent, organizer ownership, live readback, replacement safety,
  retries and revocation. Keep `GOOGLE_MEET_CALL_ENDING_ENABLED=false` until then.
- **Connect media:** with two authorized CEO/Admin accounts, test private photo,
  document and voice paths, direct-ID outsider denial, signed download behavior,
  Realtime refresh after reassignment/deactivation, and General/DM preservation.
- **Client access:** use two existing client identities and records; verify own
  portal access and cross-client denial for portal pages, messages and files.
- **Google OAuth:** reconnect the same existing organizer account against the
  exact production redirect, verify persisted encrypted refresh access and
  disconnect behavior. Do not overwrite the current connection with a different
  identity.
- **Host controls:** verify HTTPS cookies, `EBA_APP_URL` same-origin checks,
  Supabase Auth URL allowlist, callback exclusion from access logs, server-only
  secret storage, process restart behavior and scheduler timeout.

Current local regression suites for staff access, profile-only Employee/HOD
access, Google organizer flow, calendar, reminders, worker, meeting calls,
Connect private rooms, recognition, and rendering passed. They use fixtures,
mocks, static checks, or local build output; they do not establish hosted RLS,
OAuth, Google capability, database, storage, or scheduler behavior.

## Deployment and rollback runbook

1. Identify provider, plan, production hostname, Node runtime, and scheduler
   limits. Confirm 120-second requests and per-minute scheduling before release.
2. Review `supabase migration list` against the hosted project's migration
   ledger. Take the provider's normal backup/snapshot and run each feature's
   read-only preflight/verification checks. Apply only reviewed, missing forward
   migrations in timestamp order; never rerun applied migrations or modify
   historical records. Database migration application is a separate approved
   operation and was not done in this preparation.
3. Configure server secrets and URL allowlists. Verify the existing Google key,
   organizer identity and encrypted token remain available. Keep the scheduler
   disabled and `GOOGLE_MEET_CALL_ENDING_ENABLED=false` during deployment.
4. Build with `npm run build` and deploy with the provider's supported Node
   runtime/start method. Do not deploy the local worker process.
5. Before scheduling, run the host/auth acceptance checks above using existing
   authorized accounts and disposable staging records. Start the external
   scheduler only after the endpoint and its secret have been verified.
6. For rollback, disable the external schedule first, then redeploy the last
   known-good app artifact. Keep already-applied migrations and data in place;
   roll forward with a repair migration if needed. Do not restore an older
   database snapshot over newer production data as an application rollback.
   Re-enable scheduling only after the recovered release passes checks.

Outstanding decision needed: the hosting provider/plan and public production
hostname. Without them, provider-specific runtime limits, scheduler setup, and
final redirect URLs cannot be confirmed.
