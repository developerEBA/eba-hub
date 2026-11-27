select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (table_name in ('clients', 'organizations', 'organisations', 'contacts')
    or table_name like 'client%')
order by table_name, ordinal_position;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (tablename in ('clients', 'organizations', 'organisations', 'contacts')
    or tablename like 'client%')
order by tablename, policyname;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'eba_private')
  and (p.proname like '%client%directory%' or p.proname = 'hub_is_active')
order by n.nspname, p.proname;
