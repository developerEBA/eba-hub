# EBA Hub

Internal ENI Brand Architect employee workspace using Next.js App Router, strict TypeScript, Tailwind v4 and Supabase. The approved dashboard grid is preserved. The app no longer presents fictional employees, demo task state, sample messages or hardcoded statistics as operational data.

## Current status

Authenticated data paths and forms are implemented for projects, tasks, conversations/text messages, internal meeting records, approvals/leave, recognition nominations, focus, announcements, profile settings, notifications and private files. They are **not certified working end-to-end against Supabase** until an isolated project is configured and tested. Google Calendar/Meet creation, Workspace provisioning and automatic performance scoring remain unimplemented. See the exact [functionality checklist](docs/FUNCTIONALITY.md).

With no Supabase settings, development displays a read-only setup state with unavailable counts and no simulated saves. Production redirects to login by default. `EBA_SETUP_PREVIEW=true` only permits the setup dashboard without credentials; it never grants database or production authority.

## Windows development

Use Node 22.18+ or Node 24. The audited terminal defaults to Node 20, below the Supabase SDK requirement.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000. Supply these values in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `APP_URL` — canonical origin, for example `http://localhost:3000`; used for OAuth callbacks rather than trusting Host headers.
- `EBA_SETUP_PREVIEW=false` — server-only production setup-screen switch.

Never use privileged service-role keys in public configuration. No service-role key is needed by application operations. Google client secrets belong in the approved Supabase provider configuration, not browser code.

## Supabase setup and authorization

Use an **isolated project approved for test records**. Review and apply the versioned migrations in order:

```powershell
supabase link --project-ref YOUR_APPROVED_TEST_PROJECT
supabase db push
```

No migration was applied to Supabase during development. Migrations 001–005 were executed in test-only embedded PostgreSQL. Migration 006 depends on real Supabase Storage and Realtime and still needs integration validation.

After creating approved Auth test accounts through a trusted operator, create employee profiles, departments and department memberships with an administrative SQL connection. There is intentionally no automatic self-provisioning or client role write. Profiles have `is_active`; deactivation is enforced by restrictive RLS policies and the server session gate. Assign the first admin through a trusted operator, never a user-submitted form.

Enable the Google OAuth provider in Supabase with approved Google credentials and authorized redirects. Add `APP_URL/auth/callback` to Supabase's redirect allow list. Configure the provider's callback in Google using the URL shown by Supabase. See the [official Google sign-in guide](https://supabase.com/docs/guides/auth/social-login/auth-google). Do not enable unrestricted employee provisioning: a successful Google login still needs an existing active employee profile.

Project creation and participant management require management/admin, or a department lead within their department. Task edits require the creator, assignee or project management. Private conversations and meeting records remain membership scoped. Approval decisions require independent management/admin review; self approvals are rejected. Recognition is published only from approved nominations. Role changes, inactive profile changes and memberships are not writable through profile forms.

## Persistence, messages and files

Every displayed count is calculated by PostgreSQL under the caller's RLS. Project progress uses a security-invoker view over all authorized project tasks. Forms use validated Server Actions and check database results before showing success; checkboxes refresh from stored values. No localStorage imitation replaces a database operation.

Messages are inserted into PostgreSQL before appearing in the thread. Realtime subscriptions refresh persisted messages; a visible refresh control remains available if subscription setup fails. Text, Unicode emoji stickers, file attachments and voice-note upload/playback paths are implemented but require real Storage/Realtime/browser testing. A custom uploaded sticker library and paginated message history are not implemented. Threads currently show the latest 100 messages.

Files upload directly to a private Supabase Storage bucket under the signed-in owner's UUID prefix. A server action verifies the uploaded object's metadata before recording it in PostgreSQL. Downloads/playback require an RLS-authorized lookup and a short-lived signed URL. Files are limited to 4 MB and approved types. Storage migration/policies, actual uploads and microphone behavior remain untested against Supabase. There is no file scanning or retention workflow yet.

## Durable reminders

Task changes create/cancel durable reminder jobs. `deliver_due_reminders()` uses row locks, retry attempts, failure state and a unique notification delivery key. Only `service_role`/the trusted scheduler can call the runner. It creates in-app notifications; it does not send email or push messages.

Enable pg_cron in the approved project and review/run:

```sql
select cron.schedule(
  'eba-task-reminders', '* * * * *',
  'select public.deliver_due_reminders()'
);
```

This activation was not performed. The application continues to show scheduler setup required until the operator confirms activation. Job delivery logic passed PostgreSQL tests; actual recurring execution has not been verified. Calendar/Meet and Directory adapters still require implementation plus scoped provider credentials.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

The default tests execute validation rules plus core migrations, RLS, transactional workflows and cross-identity queries in PGlite (real PostgreSQL compiled to WASM). Test `auth.uid()` values are deliberately simulated; these tests do not prove Supabase Auth, REST, Storage or Realtime behavior.

For the genuine opt-in Supabase test, copy `.env.test.example` to `.env.test.local`. Configure the public project settings, four short-lived JWTs belonging to isolated manager/employee A/employee B/nonmember employee accounts, and a department ID containing manager/A/B memberships. The outsider must be an ordinary nonmember employee. Set `EBA_TEST_PROJECT_CONFIRMED=isolated` **only after approving that project for mutation**.

```powershell
npm run test:supabase
```

Without all settings this suite is skipped, never counted as a pass. It creates tagged test records, deletes its task and archives its project; test conversations, messages and approvals remain in the isolated project for inspection. Never run it against company production data. Google OAuth browser sign-in/logout, browser-refresh persistence, Realtime delivery across browser sessions and Storage must additionally be tested in that project.

## Architecture

- `src/app`: server composition, auth callback, record search, route/error/loading states.
- `src/modules/auth`: verified active-employee sessions, Google OAuth and sign-out.
- `src/modules/operations`: typed records, schemas, read model, authenticated mutations, forms, chat and private file adapters.
- `src/modules/dashboard`: approved layout composed from real records and setup/empty states.
- `src/lib/supabase`: separate SSR and browser clients; proxy preserves refreshed cookies/cache headers.
- `supabase/migrations`: versioned schema, privileges, RLS, transactional RPCs and delivery jobs.
- `tests`: unit/PostgreSQL policy tests and opt-in real Supabase integration test.

Old sample fixtures/components remain in source for historical reference but are not imported by live dashboard/module routes. No project was reinitialized, no production service deployed, no live account provisioned and no secrets written. This directory still has no Git repository.

After enabling and observing the approved pg_cron job, an operator may set REMINDER_SCHEDULER_ENABLED=true to change dashboard setup copy. That flag does not start jobs or verify scheduler health; persisted delivery records remain the evidence of execution.
