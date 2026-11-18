-- READ ONLY: run as postgres before and after the forward migration. No token,
-- attendee email, Google event ID, join URL or private job payload is selected.
begin transaction read only;
select to_regclass('public.calendar_occurrences') as part1_occurrences,
  to_regclass('public.calendar_series') as part1_series,
  to_regclass('public.google_organizer_connection') as google_authorization,
  to_regclass('public.calendar_sync_jobs') as part2_jobs;
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name in ('calendar_occurrences','calendar_sync_jobs')
  and column_name in ('id','version','provider_event_id','provider_calendar_id','join_url','sync_status','provider_conference_id','meet_space_name','recording_status','link_error_code','desired_version','lease_until');
select status,count(*) as occurrence_count from public.calendar_occurrences group by status;
select count(*) as unsupported_existing_join_urls from public.calendar_occurrences
where join_url is not null and join_url !~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$';
select enabled,status,meet_supported,refresh_ciphertext is not null as encrypted_refresh_stored
from public.google_organizer_connection;
select has_table_privilege('service_role','auth.users','SELECT') as server_can_resolve_real_emails;
select column_name,data_type from information_schema.columns where table_schema='auth' and table_name='users'
  and column_name in ('id','email','email_confirmed_at','deleted_at','banned_until');
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('calendar_sync_jobs','google_organizer_connection','google_organizer_oauth_states')
  and grantee in ('PUBLIC','anon','authenticated');
select table_name,column_name,grantee from information_schema.column_privileges
where table_schema='public' and table_name in ('calendar_occurrences','calendar_series') and grantee='authenticated'
  and column_name in ('provider_event_id','provider_calendar_id','provider_conference_id','provider_etag','meet_space_name','sync_error');
-- Before Part 2, Part 1 grants SELECT for all occurrence columns. After Part 2,
-- the private-column query above and all browser job grants must be empty.
select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and relname='calendar_sync_jobs';
select p.oid::regprocedure as routine,p.prosecdef as security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_can_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('calendar_sync_control','calendar_google_people');
rollback;
