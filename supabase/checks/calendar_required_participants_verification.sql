with catalog as (
  select
    to_regclass('public.calendar_occurrences') as occurrences,
    to_regclass('public.calendar_occurrence_participant_sources') as sources,
    to_regclass('public.calendar_google_attendee_snapshots') as google_snapshots,
    to_regclass('public.hub_notifications') as notifications,
    to_regclass('auth.users') as auth_users,
    to_regprocedure('public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb)') as mutate_rpc,
    to_regprocedure('public.calendar_mutate_v1(uuid,uuid,text,uuid,text,integer,jsonb)') as preserved_mutator,
    to_regprocedure('public.calendar_hod_create(uuid,uuid,jsonb)') as hod_rpc,
    to_regprocedure('public.calendar_hod_create_v1(uuid,uuid,jsonb)') as preserved_hod_creator,
    to_regprocedure('public.calendar_required_participant_emails()') as email_rpc,
    to_regprocedure('public.calendar_google_invitation_deltas(text,text[])') as google_delta_rpc,
    to_regprocedure('public.calendar_google_import(text,text,jsonb)') as import_wrapper,
    to_regprocedure('public.calendar_google_import_v1(text,text,jsonb)') as preserved_import,
    to_regprocedure('public.calendar_reconcile_required_participants(uuid,boolean)') as reconcile_rpc,
    to_regprocedure('public.calendar_google_people(uuid[])') as google_people_rpc,
    to_regprocedure('public.calendar_access()') as access_rpc,
    to_regprocedure('eba_private.calendar_current_member()') as current_member_rpc
), checks as (
  select
    coalesce(c.occurrences is not null,false) as occurrence_table,
    coalesce(c.sources is not null,false) as source_table,
    coalesce(c.google_snapshots is not null,false) as google_snapshot_table,
    coalesce(c.notifications is not null,false) as notifications_table,
    coalesce(c.auth_users is not null,false) as auth_users_table,
    coalesce((select relrowsecurity from pg_class where oid=c.sources),false) as sources_rls,
    coalesce((select relrowsecurity from pg_class where oid=c.google_snapshots),false) as google_snapshots_rls,
    coalesce(c.mutate_rpc is not null,false) as mutate_wrapper,
    coalesce(c.preserved_mutator is not null,false) as preserved_mutator,
    coalesce(c.hod_rpc is not null,false) as hod_wrapper,
    coalesce(c.preserved_hod_creator is not null,false) as preserved_hod_creator,
    coalesce(c.email_rpc is not null,false) as required_email_rpc,
    coalesce(c.google_delta_rpc is not null,false) as google_delta_rpc,
    coalesce(c.import_wrapper is not null,false) as import_wrapper,
    coalesce(c.preserved_import is not null,false) as preserved_import,
    coalesce(c.reconcile_rpc is not null,false) as reconcile_rpc,
    coalesce(c.google_people_rpc is not null,false) as google_people_rpc,
    coalesce(c.access_rpc is not null,false) as access_rpc,
    coalesce(c.current_member_rpc is not null,false) as current_member_rpc,
    coalesce(c.mutate_rpc is not null and has_function_privilege('authenticated',c.mutate_rpc,'EXECUTE')=false,false) as mutate_client_denied,
    coalesce(c.hod_rpc is not null and has_function_privilege('authenticated',c.hod_rpc,'EXECUTE')=false,false) as hod_client_denied,
    coalesce(c.import_wrapper is not null and has_function_privilege('authenticated',c.import_wrapper,'EXECUTE')=false,false) as import_client_denied,
    coalesce(c.reconcile_rpc is not null and has_function_privilege('authenticated',c.reconcile_rpc,'EXECUTE')=false,false) as reconcile_client_denied,
    coalesce(c.email_rpc is not null and has_function_privilege('service_role',c.email_rpc,'EXECUTE'),false) as required_email_service_granted,
    coalesce(c.google_delta_rpc is not null and has_function_privilege('service_role',c.google_delta_rpc,'EXECUTE'),false) as google_delta_service_granted,
    coalesce(c.import_wrapper is not null and has_function_privilege('service_role',c.import_wrapper,'EXECUTE'),false) as import_service_granted,
    coalesce(c.reconcile_rpc is not null and has_function_privilege('service_role',c.reconcile_rpc,'EXECUTE'),false) as reconcile_service_granted,
    coalesce(c.access_rpc is not null and has_function_privilege('authenticated',c.access_rpc,'EXECUTE'),false) as access_authenticated_granted,
    coalesce(c.current_member_rpc is not null and has_function_privilege('authenticated',c.current_member_rpc,'EXECUTE'),false) as current_member_authenticated_granted,
    coalesce(c.notifications is not null and exists(select 1 from pg_policies p
      where p.schemaname='public' and p.tablename='hub_notifications'
        and p.policyname='Calendar alerts require current occurrence visibility'
        and p.permissive='RESTRICTIVE' and p.roles::text like '%authenticated%'
        and position('attendee_ids' in coalesce(p.qual,''))>0
        and position('attendee_ids' in coalesce(p.with_check,''))>0),false) as reminder_audience_policy,
    coalesce(c.sources is not null and exists(select 1 from pg_trigger t where t.tgrelid=c.occurrences and not t.tgisinternal and t.tgname='calendar_required_participants_before'),false) as audience_enforcement_trigger,
    coalesce(c.sources is not null and exists(select 1 from pg_trigger t where t.tgrelid=c.occurrences and not t.tgisinternal and t.tgname='calendar_required_participants_after'),false) as provenance_trigger,
    coalesce(c.sources is not null and exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.staff_memberships') and not t.tgisinternal and t.tgname='calendar_membership_participant_reconcile'),false) as membership_reconcile_trigger,
    coalesce(c.sources is not null and exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.staff_department_assignments') and not t.tgisinternal and t.tgname='calendar_assignment_participant_reconcile'),false) as assignment_reconcile_trigger,
    coalesce(c.auth_users is not null and exists(select 1 from pg_trigger t where t.tgrelid=c.auth_users and not t.tgisinternal and t.tgname='calendar_auth_user_participant_reconcile'),false) as auth_reconcile_trigger
  from catalog c
), result as (
  select checks.* from checks
)
select case when occurrence_table and source_table and google_snapshot_table and notifications_table and auth_users_table and sources_rls and google_snapshots_rls and mutate_wrapper and preserved_mutator
  and hod_wrapper and preserved_hod_creator and required_email_rpc and reconcile_rpc and google_people_rpc
  and google_delta_rpc and import_wrapper and preserved_import and mutate_client_denied and hod_client_denied
  and import_client_denied and reconcile_client_denied and required_email_service_granted and google_delta_service_granted
  and import_service_granted and reconcile_service_granted and access_authenticated_granted
  and current_member_authenticated_granted and audience_enforcement_trigger
  and reminder_audience_policy and provenance_trigger and membership_reconcile_trigger and assignment_reconcile_trigger and auth_reconcile_trigger
  then 'PASS' else 'FAIL' end as result,
  jsonb_build_object(
    'occurrence_table',coalesce(occurrence_table,false),'source_table',coalesce(source_table,false),
    'google_snapshot_table',coalesce(google_snapshot_table,false),'notifications_table',coalesce(notifications_table,false),
    'auth_users_table',coalesce(auth_users_table,false),
    'sources_rls',coalesce(sources_rls,false),
    'google_snapshots_rls',coalesce(google_snapshots_rls,false),'mutate_wrapper',coalesce(mutate_wrapper,false),
    'preserved_mutator',coalesce(preserved_mutator,false),'hod_wrapper',coalesce(hod_wrapper,false),
    'preserved_hod_creator',coalesce(preserved_hod_creator,false),'required_email_rpc',coalesce(required_email_rpc,false),
    'access_rpc',coalesce(access_rpc,false),'current_member_rpc',coalesce(current_member_rpc,false),
    'google_delta_rpc',coalesce(google_delta_rpc,false),'import_wrapper',coalesce(import_wrapper,false),
    'preserved_import',coalesce(preserved_import,false),'import_client_denied',coalesce(import_client_denied,false),
    'reconcile_rpc',coalesce(reconcile_rpc,false),'google_people_rpc',coalesce(google_people_rpc,false),
    'mutate_client_denied',coalesce(mutate_client_denied,false),'hod_client_denied',coalesce(hod_client_denied,false),
    'reconcile_client_denied',coalesce(reconcile_client_denied,false),
    'required_email_service_granted',coalesce(required_email_service_granted,false),
    'google_delta_service_granted',coalesce(google_delta_service_granted,false),
    'import_service_granted',coalesce(import_service_granted,false),
    'reconcile_service_granted',coalesce(reconcile_service_granted,false),
    'access_authenticated_granted',coalesce(access_authenticated_granted,false),
    'current_member_authenticated_granted',coalesce(current_member_authenticated_granted,false),
    'reminder_audience_policy',coalesce(reminder_audience_policy,false),
    'audience_enforcement_trigger',coalesce(audience_enforcement_trigger,false),
    'provenance_trigger',coalesce(provenance_trigger,false),
    'membership_reconcile_trigger',coalesce(membership_reconcile_trigger,false),
    'assignment_reconcile_trigger',coalesce(assignment_reconcile_trigger,false),
    'auth_reconcile_trigger',coalesce(auth_reconcile_trigger,false)
  ) as diagnostic
from result
union all
select 'FAIL', jsonb_build_object('reason','calendar_occurrences or participant sources are missing')
where not exists(select 1 from result);
