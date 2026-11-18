-- READ ONLY. Works before the import-owner mapping migration is installed.
-- Only expected account emails, booleans and reason labels; no credentials,
-- OAuth states, session IDs, Google subject, verifier, nonce or token values.
begin transaction read only;
with expected(label,email) as (values
 ('google_organizer','admin@enibrand.com'),('configured_eba_admin','eba-admin-test@enibrand.com')
), checks as (
 select e.label,e.email,u.id is not null auth_user_exists,m.user_id is not null membership_exists,
   coalesce(m.status='active',false) membership_active,
   coalesce(m.role in('ceo','admin'),false) rollout_role,
   coalesce(m.role='admin',false) admin_role,
   coalesce(u.email ~* '^[^@]+@enibrand[.]com$',false) company_email,
   coalesce(u.email_confirmed_at is not null,false) email_verified,
   u.id is not null and u.deleted_at is null not_deleted,
   u.id is not null and (u.banned_until is null or u.banned_until<=statement_timestamp()) not_banned,
   coalesce(public.calendar_reminder_account_active(u.id),false) eligible
 from expected e left join auth.users u on u.email=e.email
 left join public.staff_memberships m on m.user_id=u.id
)
select *,case when not auth_user_exists then 'auth_user_missing'
 when not membership_exists then 'membership_missing'
 when not membership_active then 'membership_inactive'
 when not rollout_role then 'role_outside_ceo_admin'
 when not company_email then 'email_outside_company'
 when not email_verified then 'email_unverified'
 when not not_deleted then 'auth_user_deleted'
 when not not_banned then 'auth_user_banned'
 when label='configured_eba_admin' and not admin_role then 'mapping_requires_admin'
 else 'eligible' end eligibility_reason from checks order by label;

select c.singleton is not null connection_exists,coalesce(c.enabled,false) connection_enabled,
 coalesce(c.status='connected',false) connection_status_connected,
 coalesce(c.email='admin@enibrand.com',false) connected_email_matches_expected,
 c.subject is not null verified_google_identity_present,
 c.verified_at is not null verified_at_present,c.connected_at is not null connected_at_present,
 exists(select 1 from public.google_organizer_oauth_states s join auth.users u on u.id=s.admin_id
   where u.email='eba-admin-test@enibrand.com' and s.organizer_email=c.email
   and s.consumed_at is not null and s.saved_at=c.connected_at and s.version<c.version
 ) matching_successful_oauth_proof,
 to_regprocedure('public.calendar_google_import_owner(text,text)') is not null mapping_resolver_installed,
 coalesce(position('calendar_google_import_owner' in pg_get_functiondef(to_regprocedure('public.calendar_google_import(text,text,jsonb)')))>0,false) import_uses_resolver
from (values(true)) seed(singleton) left join public.google_organizer_connection c using(singleton);
-- Invoker functions require the actual column grants, even with BYPASSRLS.
select name,has_column_privilege('service_role','auth.users',name,'SELECT') service_can_read
from unnest(array['id','email','email_confirmed_at','deleted_at','banned_until']) name;
rollback;
