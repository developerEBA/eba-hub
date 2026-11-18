-- Read-only; run as postgres. Never returns tokens, identities or meeting details.
begin transaction read only;
select to_regclass('public.calendar_occurrences') is not null as occurrences_present,
 to_regclass('public.google_organizer_connection') is not null as google_storage_present,
 to_regclass('public.calendar_sync_jobs') is not null as sync_queue_present,
 to_regprocedure('public.calendar_reminder_account_active(uuid)') is not null as eligibility_helper_present,
 to_regclass('public.calendar_call_end_jobs') is not null as ending_migration_already_present;
select column_name from information_schema.columns
 where table_schema='public' and table_name='calendar_occurrences'
 and column_name in('version','starts_at','ends_at','status','join_url','source','provider_event_id','provider_calendar_id','joining_closed_at','call_end_status')
 order by column_name;
select count(*) as active_admin_memberships from public.staff_memberships where status='active' and role='admin';
-- Expected false for anon/authenticated after migration. NULL means not installed.
select r as role_name,t as private_table,
 case when to_regclass('public.'||t) is null then null else has_table_privilege(r,'public.'||t,'SELECT') end as can_select,
 case when to_regclass('public.'||t) is null then null else has_table_privilege(r,'public.'||t,'INSERT') end as can_insert
 from unnest(array['anon','authenticated']) r cross join unnest(array['calendar_call_end_jobs','calendar_call_end_space_leases']) t;
select r as role_name,
 case when to_regprocedure('public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb)') is null then null
 else has_function_privilege(r,'public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb)','EXECUTE') end as can_execute_private_control
 from unnest(array['anon','authenticated']) r;
rollback;
