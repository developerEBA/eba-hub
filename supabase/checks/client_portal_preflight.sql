-- Read-only. Inspect any client portal objects before applying 20261106001200.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (table_name like 'client_portal%' or table_name in ('client_directory','department_plans','staff_memberships'))
order by table_name, ordinal_position;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename like 'client_portal%')
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','eba_private')
  and (p.proname like '%client_portal%' or p.proname in ('hub_is_active','client_directory_can_write'));

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'client-shared-files';
