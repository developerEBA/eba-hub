-- Read-only preflight. No records are created, changed, or emitted.
begin transaction read only;
with expected(object_name) as (values
 ('public.staff_memberships'),('public.staff_department_assignments'),('auth.users'),('public.announcements'),
 ('public.announcement_revisions'),('public.announcement_acknowledgements'),('public.announcement_audit')
)
select object_name,case when to_regclass(object_name) is null then 'FAIL: prerequisite/release object missing' else 'PASS: present' end as result
from expected order by object_name;

with release_names(name) as (values ('public.announcements'),('public.announcement_revisions'),
 ('public.announcement_acknowledgements'),('public.announcement_audit'))
select name as check_name,case when to_regclass(name) is null then 'PASS: name is available'
 else 'FAIL: inspect existing relation before applying this migration' end as result from release_names order by name;

select 'Department assignment schema' as check_name,
 case when to_regclass('public.staff_department_assignments') is not null and exists(
  select 1 from information_schema.columns where table_schema='public' and table_name='staff_department_assignments'
  and column_name in ('user_id','department') group by table_name having count(*)=2
 ) then 'PASS' else 'FAIL: expected user_id and department columns' end as result;
rollback;
