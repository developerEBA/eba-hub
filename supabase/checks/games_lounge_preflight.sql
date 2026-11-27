begin transaction read only;

select current_database() as database_name, current_user as inspection_role;
select name, to_regclass('public.' || name) is not null as exists
from unnest(array['staff_memberships','connect_profiles','game_nights','game_rooms','game_players','game_invites','game_states','game_requests','game_results']) name;
select role, status, count(*) as memberships from public.staff_memberships group by role,status order by role,status;
select c.relname,has_table_privilege('service_role',c.oid,'SELECT') as server_can_read_prerequisite
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('staff_memberships','connect_profiles');
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('game_nights','game_rooms','game_players','game_invites','game_states','game_requests','game_results') order by c.relname;
select c.relname,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as hub_select,
  has_table_privilege('authenticated',c.oid,'INSERT') as browser_insert,
  has_table_privilege('authenticated',c.oid,'UPDATE') as browser_update,
  has_table_privilege('authenticated',c.oid,'DELETE') as browser_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('game_nights','game_rooms','game_players','game_invites','game_states','game_requests','game_results') order by c.relname;

select tablename,policyname,cmd,roles,qual from pg_policies where schemaname='public' and tablename like 'game_%' order by tablename,policyname;
select p.proname,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('games_access','games_lobby_command','games_commit') order by p.proname;
select pubname,schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename like 'game_%';
select schemaname,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('game_rooms','game_players','game_requests','game_results');
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.staff_memberships');
rollback;
