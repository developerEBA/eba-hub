-- Read-only catalog preflight. Safe to run before Calendar objects exist.
select jsonb_build_object(
  'calendar_occurrences', to_regclass('public.calendar_occurrences') is not null,
  'calendar_series', to_regclass('public.calendar_series') is not null,
  'calendar_requests', to_regclass('public.calendar_requests') is not null,
  'calendar_sync_jobs', to_regclass('public.calendar_sync_jobs') is not null,
  'calendar_reminders', to_regclass('public.calendar_reminders') is not null,
  'staff_memberships', to_regclass('public.staff_memberships') is not null,
  'staff_department_assignments', to_regclass('public.staff_department_assignments') is not null,
  'auth_users', to_regclass('auth.users') is not null,
  'current_required_participant_migration_present', to_regprocedure('public.calendar_reconcile_required_participants(uuid,boolean)') is not null
) as calendar_required_participants_preflight;
