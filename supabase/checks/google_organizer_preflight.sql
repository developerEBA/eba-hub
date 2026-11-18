-- READ ONLY. Run as postgres in the Supabase SQL editor before and after applying
-- 20261116143000_google_organizer_authorization.sql. Never selects credentials.
begin transaction read only;
select current_user, current_database(), current_setting('server_version') as postgres_version;
select to_regclass('public.staff_memberships') as memberships,
       to_regclass('auth.sessions') as sessions,
       to_regclass('public.google_organizer_connection') as connection_table,
       to_regclass('public.google_organizer_oauth_states') as state_table;
select table_schema,table_name,column_name,data_type
from information_schema.columns
where (table_schema='public' and table_name='staff_memberships' and column_name in ('user_id','role','status'))
   or (table_schema='auth' and table_name='sessions' and column_name in ('id','user_id','not_after'));
select role,status,count(*) as staff_count from public.staff_memberships group by role,status;
select has_table_privilege('service_role','auth.sessions','SELECT') as server_can_check_live_sessions,
       has_table_privilege('service_role','auth.users','SELECT') as server_can_check_staff_email,
       has_table_privilege('service_role','public.staff_memberships','SELECT') as server_can_check_active_admin;
-- After migration: browser_grants and browser_executable must both be empty.
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('google_organizer_connection','google_organizer_oauth_states')
  and grantee in ('PUBLIC','anon','authenticated');
select c.relname,c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('google_organizer_connection','google_organizer_oauth_states');
select schemaname,tablename,policyname,roles from pg_policies
where schemaname='public' and tablename in ('google_organizer_connection','google_organizer_oauth_states');
select p.oid::regprocedure as function_name,p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_executable,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_executable,
       has_function_privilege('service_role',p.oid,'EXECUTE') as server_executable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='google_organizer_authorize';
rollback;
