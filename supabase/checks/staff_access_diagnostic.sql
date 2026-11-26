-- One result table, named PASS/FAIL checks. No writes, identities, hashes or credentials.
begin transaction read only;
with definition as(
 select coalesce(pg_get_functiondef(to_regprocedure('public.staff_access_control(text,uuid,jsonb)')),'') as body
), checks(check_name,passed,detail) as(values
 ('memberships_present',to_regclass('public.staff_memberships') is not null,'Existing memberships, not a parallel access model'),
 ('real_department_assignments_present',to_regclass('public.staff_department_assignments') is not null,'Calendar Part 1 assignment table'),
 ('client_access_isolation_present',to_regclass('public.client_portal_access') is not null,'Staff invitations must reject client-bound identities'),
 ('directory_profiles_present',to_regclass('public.staff_access_profiles') is not null,'Management names; no fabricated staff records'),
 ('private_invitations_present',to_regclass('public.staff_access_invites') is not null,'Apply staff-access forward migration'),
 ('private_audit_present',to_regclass('public.staff_access_audit') is not null,'Actor, action, target, time and changes'),
 ('server_auth_identity_columns_granted',(select bool_and(has_column_privilege('service_role','auth.users',c,'SELECT')) from unnest(array['id','email','email_confirmed_at','deleted_at','banned_until']) c),'Only the Auth identity/eligibility fields needed by the service transaction'),
 ('existing_roles_and_hod_preserved',exists(select 1 from pg_constraint where conrelid=to_regclass('public.staff_memberships')
  and conname='staff_memberships_role_check' and pg_get_constraintdef(oid) like '%ceo%' and pg_get_constraintdef(oid) like '%admin%'
  and pg_get_constraintdef(oid) like '%staff%' and pg_get_constraintdef(oid) like '%hod%'),'Forward constraint retains ceo/admin/staff'),
 ('optimistic_revision_present',exists(select 1 from information_schema.columns where table_schema='public' and table_name='staff_memberships' and column_name='access_version'),'Concurrent updates must include expected revision'),
 ('private_tables_have_rls',(select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in(to_regclass('public.staff_access_profiles'),to_regclass('public.staff_access_invites'),to_regclass('public.staff_access_audit'))),'Browser access is revoked; service-only management RPC'),
 ('pending_invites_unique',exists(select 1 from pg_indexes where schemaname='public' and tablename='staff_access_invites' and indexname='staff_access_one_pending_email' and indexdef like '%UNIQUE%' and indexdef like '%WHERE%'),'One pending invitation per normalized email'),
 ('rpc_security_invoker',exists(select 1 from pg_proc where oid=to_regprocedure('public.staff_access_control(text,uuid,jsonb)') and not prosecdef),'Explicit service privileges, not a new public definer bypass'),
 ('rpc_available_to_server',case when to_regprocedure('public.staff_access_control(text,uuid,jsonb)') is null then false else has_function_privilege('service_role','public.staff_access_control(text,uuid,jsonb)','EXECUTE') end,'Server-only database access'),
 ('admin_ceo_write_gate_defined',(select body like '%caller<>''admin''%' from definition),'CEO directory read only'),
 ('self_last_admin_privilege_guards_defined',(select body like '%target=p_actor%' and body like '%Cannot remove last active Admin%' and body like '%Privileged accounts require controlled provisioning%' from definition),'Controlled provisioning remains separate'),
 ('acceptance_identity_expiry_guards_defined',(select body like '%invite.expires_at<=clock_timestamp()%' and body like '%u.id is distinct from invite.account_id%' and body like '%u.email_confirmed_at is null%' from definition),'Verified bound identity; expiration and single-use enforced in transaction'),
 ('concurrent_mutation_lock_defined',(select body like '%pg_advisory_xact_lock%' and body like '%access_version is distinct from%' from definition),'Static definition check; not proof of live concurrency'),
 ('rollout_gate_preserved_in_connect',coalesce(pg_get_functiondef(to_regprocedure('eba_private.connect_is_active(uuid)')) like '%ceo%' and pg_get_functiondef(to_regprocedure('eba_private.connect_is_active(uuid)')) not like '%hod%',false),'Current chat gate must still exclude unfinished dashboards'),
 ('audit_has_no_secret_columns',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='staff_access_audit' and column_name in('password','token','token_hash','credentials')),'Audit payloads are built from assignment/status only')
), privacy as(
 select 'browser_'||r||'_'||t||'_denied' as check_name,
 case when to_regclass('public.'||t) is null then false else not has_any_column_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,REFERENCES')
  and not has_table_privilege(r,'public.'||t,'DELETE,TRUNCATE,TRIGGER') end as passed,'No browser access to invitation hashes, profiles or audit storage' as detail
 from unnest(array['anon','authenticated']) r cross join unnest(array['staff_access_invites','staff_access_profiles','staff_access_audit']) t
), rpc_privacy as(
 select 'browser_'||r||'_rpc_denied' as check_name,case when to_regprocedure('public.staff_access_control(text,uuid,jsonb)') is null then false
  else not has_function_privilege(r,'public.staff_access_control(text,uuid,jsonb)','EXECUTE') end as passed,'All mutations and directory reads recheck management authorization on the server' as detail
 from unnest(array['anon','authenticated']) r
)
select check_name,case when passed then 'PASS' else 'FAIL' end as result,detail from (select * from checks union all select * from privacy union all select * from rpc_privacy) q order by check_name;
rollback;
