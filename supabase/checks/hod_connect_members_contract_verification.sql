-- One-row, read-only verification for the Connect member-list RPC after the
-- HOD migration or its compatibility repair. Safe when the function is absent.
begin transaction read only;

with target as (
  select to_regprocedure('public.connect_department_members(uuid)') as routine_oid
), routine as (
  select p.*,
    pg_get_function_result(p.oid) as result_shape,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p join target t on t.routine_oid=p.oid
), checks as (
  select 'function_exists'::text as check_name, (select routine_oid is not null from target) as passed
  union all
  select 'three_column_return_contract',coalesce((
    select lower(regexp_replace(result_shape,'\s+','','g'))='table(user_iduuid,display_nametext,avatar_urltext)'
    from routine
  ),false)
  union all
  select 'department_membership_and_room_access',coalesce((
    select definition like '%connect_can_read(room)%'
      and definition like '%a.department=c.department%'
      and definition like '%m.status=''active''%'
      and definition like '%m.role in(''ceo'',''admin'')%'
    from routine
  ),false)
  union all
  select 'authenticated_execute_grant',coalesce((
    select case when exists(select 1 from pg_roles where rolname='authenticated')
      then has_function_privilege('authenticated',routine_oid,'EXECUTE') else false end
    from target where routine_oid is not null
  ),false)
  union all
  select 'anon_execute_denied',coalesce((
    select case when exists(select 1 from pg_roles where rolname='anon')
      then not has_function_privilege('anon',routine_oid,'EXECUTE') else false end
    from target where routine_oid is not null
  ),false)
  union all
  select 'public_execute_denied',coalesce((
    select not exists(
      select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) from routine
  ),false)
  union all
  select 'security_definer_with_empty_search_path',coalesce((
    select prosecdef and proconfig @> array['search_path=""']
    from routine
  ),false)
)
select case when bool_and(passed) then 'PASS' else 'FAIL' end as result,
       jsonb_agg(jsonb_build_object('check',check_name,'result',case when passed then 'PASS' else 'FAIL' end)
         order by check_name) as checks,
       coalesce((
         select jsonb_agg(pg_describe_object(d.classid,d.objid,d.objsubid)
           order by d.classid,d.objid,d.objsubid)
         from pg_depend d join target t on t.routine_oid=d.refobjid
         where d.refclassid='pg_proc'::regclass
       ),'[]'::jsonb) as catalog_dependents
from checks;

rollback;
