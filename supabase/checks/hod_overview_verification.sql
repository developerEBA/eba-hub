-- One-row read-only verification after 20261126100000_hod_overview_access.sql.
begin transaction read only;
with targets as (
  select to_regprocedure('public.hod_department_approval_summary()') as summary_fn,
    to_regprocedure('public.period_recognition_winner_profiles(text,date)') as winners_fn
), routines as (
  select t.summary_fn,t.winners_fn,
    case when t.summary_fn is null then null else pg_get_functiondef(t.summary_fn) end as summary_def,
    case when t.winners_fn is null then null else pg_get_functiondef(t.winners_fn) end as winners_def,
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=t.summary_fn) as summary_secure,
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=t.winners_fn) as winners_secure
  from targets t
), checks as (
  select 'department approval summary function exists'::text as check_name,summary_fn is not null as passed from routines
  union all select 'department queue uses active HOD membership and real assignments',coalesce(summary_def like '%hod_dashboard_member%' and summary_def like '%staff_department_assignments%' and summary_def like '%r.department%' and summary_def like '%r.status=''pending''%',false) from routines
  union all select 'department queue excludes message, reviewer and attachment fields',coalesce(summary_def not like '%r.message%' and summary_def not like '%decision_note%' and summary_def not like '%attachment_names%' and summary_def not like '%reviewer_email%',false) from routines
  union all select 'department summary function is security definer with fixed search path',coalesce(summary_secure,false) from routines
  union all select 'authenticated can call department summary',coalesce(case when summary_fn is not null and exists(select 1 from pg_roles where rolname='authenticated') then has_function_privilege('authenticated',summary_fn,'EXECUTE') else false end,false) from routines
  union all select 'public and anonymous cannot call department summary',coalesce(case when summary_fn is not null then not exists(
    select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=summary_fn and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) and (not exists(select 1 from pg_roles where rolname='anon') or not has_function_privilege('anon',summary_fn,'EXECUTE')) else false end,false) from routines
  union all select 'HOD request reads require current assigned department',exists(select 1 from pg_policies where schemaname='public' and tablename='approval_requests' and policyname='HODs read only their own submitted requests' and qual like '%hod_in_department%') from routines
  union all select 'HOD approval uploads require current assigned department',exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='HODs read only their own assigned department approval documents' and qual like '%hod_in_department%') from routines
  union all select 'published winner profile RPC remains publication-only and allows active HOD overview',winners_fn is not null and coalesce(winners_def like '%published_at is not null%' and winners_def like '%hub_is_active%' and winners_def like '%hod_dashboard_member%' and winners_def like '%employee_month%' and winners_def like '%teamwork_month%' and winners_def like '%most_improved_month%',false) from routines
  union all select 'winner profile RPC is security definer with fixed search path',coalesce(winners_secure,false) from routines
)
select case when bool_and(passed) then 'PASS' else 'FAIL' end as result,
  jsonb_agg(jsonb_build_object('check',check_name,'result',case when passed then 'PASS' else 'FAIL' end) order by check_name) as checks
from checks;
rollback;
