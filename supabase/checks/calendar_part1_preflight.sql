-- READ ONLY. Safe before and after the Calendar Part 1 migration.
begin transaction read only;
select current_database() as database_name,current_user as inspection_role;
select name,to_regclass('public.'||name) is not null as exists
from unnest(array['staff_memberships','connect_profiles','staff_department_assignments','calendar_series','calendar_occurrences','calendar_requests','calendar_reminders']) name;
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and (table_name like '%department%' or table_name in ('staff_memberships','connect_profiles')) order by table_name,ordinal_position;
select role,status,count(*) as people from public.staff_memberships group by role,status order by role,status;
-- Test identities only. This never creates users or changes membership.
select u.email,m.role,m.status from auth.users u join public.staff_memberships m on m.user_id=u.id
where u.email in ('eba-admin-test@enibrand.com','eba-ceo-test@enibrand.com','eba-calendar-uninvited-test@enibrand.com');
select c.relname,c.relrowsecurity as rls_enabled,
  has_table_privilege('anon',c.oid,'SELECT') as anon_read,
  has_table_privilege('authenticated',c.oid,'SELECT') as browser_read,
  has_table_privilege('authenticated',c.oid,'INSERT') as browser_insert,
  has_table_privilege('authenticated',c.oid,'UPDATE') as browser_update,
  has_table_privilege('authenticated',c.oid,'DELETE') as browser_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
and c.relname in ('staff_department_assignments','calendar_series','calendar_occurrences','calendar_requests','calendar_reminders') order by c.relname;
select tablename,policyname,cmd,roles,qual from pg_policies where schemaname='public' and (tablename like 'calendar_%' or tablename='staff_department_assignments') order by tablename,policyname;
select p.proname,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('calendar_access','calendar_mutate','calendar_invalidate_reminders');
-- Expected: browser_read only on the three metadata tables, no browser writes;
-- calendar_access is browser-callable, calendar_mutate is server-only.
select event_object_table,trigger_name,action_statement from information_schema.triggers
where trigger_schema='public' and event_object_table='calendar_occurrences';
do $$
declare total integer;
begin
  if to_regclass('public.staff_department_assignments') is not null then
    execute 'select count(*) from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id where m.status=''active'' and m.role in (''ceo'',''admin'')' into total;
    raise notice 'Real active department assignments: %. Zero means department choices must stay empty.',total;
  else raise notice 'No staff assignments table yet. Calendar migration creates an EMPTY assignment table.';
  end if;
end $$;
rollback;
