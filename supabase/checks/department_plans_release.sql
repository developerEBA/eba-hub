-- Run on the target database before releasing Department Plans.
-- Check installed effects so SQL Editor and CLI deployments are both supported.
do $$
declare
  relation regclass;
  table_name text;
begin
  foreach table_name in array array['department_plans', 'department_plan_items', 'department_plan_attachments']
  loop
    relation := to_regclass('public.' || table_name);
    if relation is null or not exists (
      select 1 from pg_class where oid = relation and relrowsecurity
    ) then
      raise exception 'Department Plans release blocked: apply migration 20261106000100 and enable RLS on %', table_name;
    end if;

    if not has_table_privilege('authenticated', relation, 'SELECT')
       or has_any_column_privilege('authenticated', relation, 'INSERT, UPDATE')
       or has_table_privilege('authenticated', relation, 'DELETE, TRUNCATE')
       or has_any_column_privilege('anon', relation, 'SELECT, INSERT, UPDATE')
       or has_table_privilege('anon', relation, 'DELETE, TRUNCATE') then
      raise exception 'Department Plans release blocked: unexpected grants on %', table_name;
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id = 'department-plan-files' and public is false)
     or (
       select count(*) from pg_policies
       where cmd = 'SELECT' and roles = array['authenticated']::name[]
         and (schemaname, tablename, policyname) in (
           ('public', 'department_plan_items', 'Read items on visible plans'),
           ('public', 'department_plan_attachments', 'Read attachment metadata on visible plans'),
           ('storage', 'objects', 'Read files on visible plans')
         )
     ) <> 3 then
    raise exception 'Department Plans release blocked: private bucket or base read policies are missing (20261106000100)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'department_plans'
      and policyname = 'Active CEOs and Admins can read submitted plans'
      and cmd = 'SELECT' and roles = array['authenticated']::name[]
      and qual like all (array['%''ceo''%', '%''admin''%', '%''active''%', '%''submitted''%', '%auth.uid()%'])
  ) then
    raise exception 'Department Plans release blocked: apply Admin read access migration 20261106000200';
  end if;

  raise notice 'Department Plans migration checks passed';
end
$$;
