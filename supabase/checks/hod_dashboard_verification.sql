with functions as (
 select
  pg_get_functiondef(to_regprocedure('eba_private.hod_dashboard_member(uuid)')) as hod_member,
  pg_get_functiondef(to_regprocedure('eba_private.connect_is_active(uuid)')) as connect_active,
  pg_get_functiondef(to_regprocedure('public.calendar_access()')) as calendar_access,
  pg_get_functiondef(to_regprocedure('public.calendar_reminder_account_active(uuid)')) as reminder_active,
  pg_get_functiondef(to_regprocedure('public.calendar_hod_create(uuid,uuid,jsonb)')) as calendar_hod_create,
  pg_get_functiondef(to_regprocedure('public.hod_department_plan_save(uuid,text,text,date,uuid,integer,text,text,jsonb,boolean)')) as plan_save,
  pg_get_functiondef(to_regprocedure('public.announcement_next()')) as announcement_next,
  pg_get_functiondef(to_regprocedure('eba_private.announcement_recipient_access(uuid,integer)')) as announcement_access,
  pg_get_functiondef(to_regprocedure('public.staff_access_control(text,uuid,jsonb)')) as staff_access,
  pg_get_functiondef(to_regprocedure('public.staff_access_update_assignments(uuid,jsonb)')) as assignment_update,
  pg_get_functiondef(to_regprocedure('public.games_access()')) as games_access,
  pg_get_functiondef(to_regprocedure('public.games_lobby_command(uuid,uuid,uuid,text,jsonb)')) as game_lobby,
  pg_get_functiondef(to_regprocedure('public.games_commit(uuid,uuid,uuid,integer,jsonb,text,integer)')) as game_commit
), checks(check_name,passed) as (
 select 'HOD membership requires active verified assigned account',coalesce(hod_member like '%role = ''hod''%' and hod_member like '%staff_department_assignments%' and hod_member like '%email_confirmed_at%',false) from functions union all
 select 'Ordinary Employee remains outside active Connect/dashboard gate',coalesce(connect_active like '%hod%' and connect_active not like '%role = ''staff''%',false) from functions union all
 select 'HOD meeting access remains organizer or explicit attendee only',coalesce(calendar_access like '%hod_dashboard_member%' and exists(select 1 from pg_policies where schemaname='public' and tablename='calendar_occurrences' and qual like '%organizer_id%' and qual like '%attendee_ids%'),false) from functions union all
 select 'HOD private reminder accounts require current membership',coalesce(reminder_active like '%hod%' and reminder_active like '%email_confirmed_at%',false) from functions union all
 select 'HOD meeting creation RPC is present and checks department assignment',coalesce(calendar_hod_create like '%hod_dashboard_member%' and calendar_hod_create like '%staff_department_assignments%' and calendar_hod_create like '%calendar_requests%',false) from functions union all
 select 'HOD plan save tracks version, assignee and completion without inferring old owners',coalesce(plan_save like '%created_by%' and plan_save like '%version%' and plan_save like '%assignee_user_id%' and plan_save like '%completed_at%',false) from functions union all
 select 'HOD plans are restricted to assigned departments and own drafts',exists(select 1 from pg_policies where schemaname='public' and tablename='department_plans' and policyname='Assigned HODs read submitted department plans') and exists(select 1 from pg_policies where schemaname='public' and tablename='department_plans' and policyname='HOD authors read their assigned department drafts') union all
 select 'HOD approvals are restricted to own requests',exists(select 1 from information_schema.columns where table_schema='public' and table_name='approval_requests' and column_name='requester_id') and exists(select 1 from pg_policies where schemaname='public' and tablename='approval_requests' and policyname='HODs read only their own submitted requests') union all
 select 'HOD Connect membership uses current active assignment',coalesce(connect_active like '%hod%' and connect_active like '%staff_department_assignments%',false) from functions union all
 select 'HOD announcement recipient path is published and audience-scoped',coalesce(announcement_next like '%announcement_recipient_access%' and announcement_access like '%published%' and announcement_access like '%staff_department_assignments%',false) from functions union all
 select 'HOD can read published recognition result only',exists(select 1 from pg_policies where schemaname='public' and tablename='period_recognition_results' and policyname='Active HODs read published recognition results') and not exists(select 1 from pg_policies where schemaname='public' and tablename='period_recognition_reviews' and policyname ilike '%HOD%') union all
 select 'HOD Games access and moves require active assignment',coalesce(games_access like '%hod_dashboard_member%' and game_lobby like '%hod_dashboard_member%' and game_commit like '%hod_dashboard_member%',false) from functions union all
 select 'Admin invitation directory reports HOD access while Employee rollout stays false',coalesce(staff_access like '%dashboard_available%invite.role=''hod''%' and staff_access like '%m.role=''hod''%',false) from functions union all
 select 'Admin-only multi-department update RPC exists',coalesce(assignment_update like '%Active Admin required%' and assignment_update like '%staff_department_assignments%',false) from functions union all
 select 'Private approval and department plan buckets remain non-public',exists(select 1 from storage.buckets where id='approval-request-files' and public=false) and exists(select 1 from storage.buckets where id='department-plan-files' and public=false)
)
select check_name,case when passed then 'PASS' else 'FAIL' end as result from checks order by check_name;
