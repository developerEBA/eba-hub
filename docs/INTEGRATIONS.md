# Integration boundaries and roadmap

All external adapters are unimplemented. Contracts live in `src/modules/integrations/contracts.ts`. No provider calls, jobs or side effects run.

1. Auth: configure Supabase, restrict signup/invitations, implement approved employee sign-in and sign-out, bootstrap the first admin with a trusted operator, and test revoked membership. Server gates validate claims and employee profile; call requireWorkspaceRole at privileged entry points.
2. Database: review migrations, apply to an isolated Supabase project, generate database types, and test RLS using two employees, a department lead, management, admin and an outsider. Verify cross-project, conversation and notification isolation, impersonation rejection, and default-denied profile/role writes. Read-only policies intentionally precede editing services.
3. Tasks/projects: introduce owning services/repositories, validate with shared schemas and implement authorized CRUD with audit events. Presentation task completion is currently ephemeral.
4. Chat: private Storage buckets with membership-scoped policies, MIME/size limits, signed access, scanning and retention for voice/image/stickers. Messages support text only in this migration. Realtime publication and subscriptions need authorization tests before activation; client reconnect must deduplicate messages.
5. Calendar/Meet: delegated OAuth server credentials with least scopes and approved Workspace domain; server-resolved attendee emails; idempotency request IDs, timezone-aware times, retries and provider event reconciliation. No example meeting is a real booking.
6. Reminders: durable server job store and worker, deduplication key, lease/retry/dead-letter handling. Do not rely on open browser tabs. Notification creation is trusted-server-only; read marking awaits a column-scoped policy/service.
7. Directory: domain-scoped delegation only after administrator approval, approval/audit records, duplicate detection and explicit revocation. No frontend provisioning authority.
8. Recognition: human-reviewed evidence and published criteria with appeal process. Do not score people by message counts or automated sentiment. Award/performance calculations are not implemented.
9. Reporting: role-scoped aggregation, period/timezone definitions, minimal personal data and audit/export retention. Notifications and reports need independent authorization at service entry points.
10. Deployment: Dockerfile and VPS reverse proxy/TLS, secret injection, backups, restoration drills, health checks, observability and CI. No deployment prepared or performed in this change.

Departments currently have memberships; department leads can read projects in their own departments. Management/admin can read projects workspace-wide, but private conversations and meetings remain membership scoped. The visible Admin Console is only coming-soon copy; it exposes no management data or operations.
