begin transaction read only;
with checks(check_name,passed,explanation) as(values
 ('parts_1_2_3_and_import_present',
  to_regclass('public.calendar_occurrences') is not null and to_regclass('public.calendar_sync_jobs') is not null
  and to_regclass('public.calendar_reminders') is not null and to_regclass('public.calendar_google_import_state') is not null,
  'Required existing calendar, synchronization, reminder and import tables'),
 ('encrypted_connection_storage_present',to_regclass('public.google_organizer_connection') is not null,'Existing organizer storage; does not verify runtime OAuth scopes'),
 ('closure_queue_present',to_regclass('public.calendar_call_end_jobs') is not null,'Apply the November 18 joining-window migration first'),
 ('shared_space_leases_present',to_regclass('public.calendar_call_end_space_leases') is not null,'Private durable concurrency fence'),
 ('closure_management_forward_migration_present',
  coalesce(pg_get_functiondef(to_regprocedure('public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb)')) like '%Authorized Admin organizer required%',false),
  'Apply the November 19 closure-management migration'),
 ('no_browser_control_execution',case when to_regprocedure('public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb)') is null then false else
  not has_function_privilege('anon','public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb)','EXECUTE') and
  not has_function_privilege('authenticated','public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb)','EXECUTE') end,'Only service role can request/claim/finish jobs'),
 ('no_browser_legacy_control_execution',case when to_regprocedure('public.calendar_call_end_control_v1(text,uuid,uuid,uuid,jsonb)') is null then false else
  not has_function_privilege('anon','public.calendar_call_end_control_v1(text,uuid,uuid,uuid,jsonb)','EXECUTE') and
  not has_function_privilege('authenticated','public.calendar_call_end_control_v1(text,uuid,uuid,uuid,jsonb)','EXECUTE') end,'Internal implementation is also private'),
 ('occurrence_fields_present',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='calendar_occurrences'
  and column_name in('joining_closed_at','call_end_status')),'Safe occurrence closure fields'),
 ('reschedule_and_lease_triggers_present',(select count(*)=2 from pg_trigger where not tgisinternal and tgrelid=to_regclass('public.calendar_occurrences')
  and tgname in('calendar_call_end_plan','calendar_call_end_guard') and tgenabled<>'D'),'Replan schedules and reject edits during live termination lease'),
 ('completed_end_history_guard_present',exists(select 1 from pg_trigger where not tgisinternal and tgrelid=to_regclass('public.calendar_occurrences')
  and tgname='calendar_call_end_terminal_history' and tgenabled<>'D'),'Later provider updates cannot requeue completed ending against a restarted call'),
 ('private_tables_rls_enabled',(select count(*)=2 and bool_and(relrowsecurity) from pg_class where oid in(to_regclass('public.calendar_call_end_jobs'),to_regclass('public.calendar_call_end_space_leases'))),'Defense in depth on both private tables'),
 ('browser_provider_ids_hidden',not exists(select 1 from information_schema.column_privileges where table_schema='public' and table_name='calendar_occurrences'
  and grantee in('anon','authenticated','PUBLIC') and column_name in('provider_event_id','provider_calendar_id','provider_etag')),'Provider identifiers must never be browser-readable')
)
select check_name,case when passed then 'PASS' else 'FAIL' end as result,explanation from checks order by check_name;
select 'private_table_'||t||'_'||r as check_name,
 case when to_regclass('public.'||t) is null then 'FAIL'
  when has_any_column_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,REFERENCES')
   or has_table_privilege(r,'public.'||t,'DELETE,TRUNCATE,TRIGGER') then 'FAIL' else 'PASS' end as result
 from unnest(array['calendar_call_end_jobs','calendar_call_end_space_leases','google_organizer_connection']) t
 cross join unnest(array['anon','authenticated']) r;
do $$
declare n bigint; enabled boolean;
begin
 if to_regclass('public.calendar_call_end_jobs') is null then
  raise notice 'queue_invariants: FAIL (closure queue missing)';
 else
  execute $q$select count(*) from public.calendar_call_end_jobs j join public.calendar_occurrences o on o.id=j.occurrence_id
   where j.state in('pending','retry','processing') and (j.desired_version<>o.version or o.status<>'scheduled'
    or (not j.manual and j.due_at<>o.ends_at+interval '3 hours'))$q$ into n;
  raise notice 'current_queue_versions_and_deadlines: % (violations=%)',case when n=0 then 'PASS' else 'FAIL' end,n;
  execute $q$select count(*) from public.calendar_call_end_jobs j where j.state='processing' and (j.lease is null or j.lease_until is null)$q$ into n;
  raise notice 'processing_jobs_have_leases: % (violations=%)',case when n=0 then 'PASS' else 'FAIL' end,n;
  execute $q$select count(*) from public.calendar_call_end_jobs where state='retry' and attempts>=8$q$ into n;
  raise notice 'retry_attempts_bounded: % (violations=%)',case when n=0 then 'PASS' else 'FAIL' end,n;
 end if;
 if to_regclass('public.google_organizer_connection') is null then
  raise notice 'organizer_enabled_and_securely_stored: FAIL (connection storage missing)';
 else
  execute $q$select coalesce(bool_or(enabled and refresh_ciphertext is not null and status='connected'),false) from public.google_organizer_connection$q$ into enabled;
  raise notice 'organizer_enabled_and_securely_stored: %',case when enabled then 'PASS' else 'FAIL' end;
 end if;
 if to_regclass('public.staff_memberships') is not null then
  execute $q$select count(*) from public.staff_memberships where role='admin' and status='active'$q$ into n;
  raise notice 'active_admin_membership_present: %',case when n>0 then 'PASS' else 'FAIL' end;
 end if;
 raise notice 'runtime_scope_and_provider_eligibility: NOT VERIFIED (use documented explicit disposable-call acceptance)';
 raise notice 'scheduler_deployment_and_120_second_runtime: NOT VERIFIED (operator configuration)';
end $$;
rollback;
