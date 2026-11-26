-- Read-only catalog check for the failed 20261126120000 migration.
-- Returns one row and does not inspect or change meeting/person records.
begin transaction read only;
with objects as (
  select
    to_regclass('public.calendar_occurrence_participant_sources') is not null as sources_table,
    to_regclass('public.calendar_google_attendee_snapshots') is not null as google_snapshot_table,
    to_regprocedure('eba_private.calendar_required_source(uuid)') is not null as required_source,
    to_regprocedure('eba_private.calendar_current_member()') is not null as current_member,
    to_regprocedure('public.calendar_required_participant_emails()') is not null as required_email_rpc,
    to_regprocedure('public.calendar_google_invitation_deltas(text,text[])') is not null as google_delta_rpc,
    to_regprocedure('public.calendar_google_import_v1(text,text,jsonb)') is not null as preserved_google_import,
    to_regprocedure('public.calendar_mutate_v1(uuid,uuid,text,uuid,text,integer,jsonb)') is not null as preserved_mutator,
    to_regprocedure('public.calendar_hod_create_v1(uuid,uuid,jsonb)') is not null as preserved_hod_create,
    to_regprocedure('public.calendar_reconcile_required_participants(uuid,boolean)') is not null as reconcile_rpc,
    exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.calendar_occurrences')
      and not t.tgisinternal and t.tgname='calendar_required_participants_before') as before_trigger,
    exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.calendar_occurrences')
      and not t.tgisinternal and t.tgname='calendar_required_participants_after') as after_trigger,
    exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.staff_memberships')
      and not t.tgisinternal and t.tgname='calendar_membership_participant_reconcile') as membership_trigger,
    exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.staff_department_assignments')
      and not t.tgisinternal and t.tgname='calendar_assignment_participant_reconcile') as assignment_trigger,
    exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('auth.users')
      and not t.tgisinternal and t.tgname='calendar_auth_user_participant_reconcile') as auth_trigger,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename='hub_notifications'
      and p.policyname='Calendar alerts require current occurrence visibility'
      and p.permissive='RESTRICTIVE'
      and position('attendee_ids' in coalesce(p.qual,''))>0
      and position('attendee_ids' in coalesce(p.with_check,''))>0) as current_audience_policy
), classified as (
  select objects.*,
    (sources_table or google_snapshot_table or required_source or current_member or required_email_rpc
      or google_delta_rpc or preserved_google_import or preserved_mutator or preserved_hod_create
      or reconcile_rpc or before_trigger or after_trigger or membership_trigger or assignment_trigger
      or auth_trigger) as any_migration_artifact,
    (sources_table and google_snapshot_table and required_source and current_member and required_email_rpc
      and google_delta_rpc and preserved_google_import and preserved_mutator and preserved_hod_create
      and reconcile_rpc and before_trigger and after_trigger and membership_trigger and assignment_trigger
      and auth_trigger and current_audience_policy) as complete
  from objects
)
select case when complete then 'COMPLETE'
            when not any_migration_artifact then 'CLEAN_ROLLBACK'
            else 'PARTIAL' end as migration_state,
       to_jsonb(classified) as object_status
from classified;
rollback;
