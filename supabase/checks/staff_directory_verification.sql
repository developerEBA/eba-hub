-- Focused read-only check. One result table; no personal records or credentials.
-- Run as postgres. Includes an actual directory execution under service_role privileges.
begin transaction read only;
set local role service_role;
with eligible as materialized (
 select m.user_id from public.staff_memberships m join auth.users u on u.id=m.user_id
 where m.status='active' and m.role in('admin','ceo') and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
 and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
 order by case when m.role='admin' then 0 else 1 end,m.user_id limit 1
), executed as materialized (
 select public.staff_access_control('directory',user_id,'{}'::jsonb) as payload from eligible
), field_grants as (
 select bool_and(has_column_privilege('service_role','public.'||t,c,'SELECT')) as ok from (values
 ('staff_memberships','user_id'),('staff_memberships','role'),('staff_memberships','status'),('staff_memberships','access_version'),
 ('staff_access_profiles','user_id'),('staff_access_profiles','name'),('connect_profiles','user_id'),('connect_profiles','display_name'),
 ('staff_department_assignments','user_id'),('staff_department_assignments','department'),
 ('staff_access_invites','id'),('staff_access_invites','name'),('staff_access_invites','email'),('staff_access_invites','role'),('staff_access_invites','department'),
 ('staff_access_invites','status'),('staff_access_invites','expires_at'),('staff_access_invites','account_id'),('staff_access_invites','created_at'),
 ('staff_access_audit','id'),('staff_access_audit','actor'),('staff_access_audit','action'),('staff_access_audit','target'),('staff_access_audit','created_at')) f(t,c)
), checks(check_name,passed) as(values
 ('directory_public_column_grants',(select ok from field_grants)),
 ('directory_auth_identity_column_grants',(select bool_and(has_column_privilege('service_role','auth.users',c,'SELECT')) from unnest(array['id','email','email_confirmed_at','deleted_at','banned_until']) c)),
 ('eligible_management_identity_present',exists(select 1 from eligible)),
 ('actual_service_role_directory_response',(select coalesce(bool_and(jsonb_typeof(payload->'members')='array' and jsonb_typeof(payload->'invitations')='array' and jsonb_typeof(payload->'audit')='array' and jsonb_typeof(payload->'truncated')='boolean'),false) from executed)),
 ('audit_projection_qualified',pg_get_functiondef('public.staff_access_control(text,uuid,jsonb)'::regprocedure) like '%audit.target%'),
 ('browser_rpc_still_denied',not has_function_privilege('authenticated','public.staff_access_control(text,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.staff_access_control(text,uuid,jsonb)','EXECUTE'))
)
select check_name,case when passed then 'PASS' else 'FAIL' end as result from checks order by check_name;
rollback;
