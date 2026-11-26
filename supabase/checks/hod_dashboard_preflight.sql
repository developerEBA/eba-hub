-- READ ONLY. Run against the intended project before applying the HOD
-- migration. This reports prerequisites only and returns no personal records.
with required_objects(name, object_name) as (values
  ('Staff memberships','public.staff_memberships'),
  ('Real department assignments','public.staff_department_assignments'),
  ('Staff access invitations/audit','public.staff_access_control(text,uuid,jsonb)'),
  ('Department plan tables','public.department_plans'),
  ('Plan task table','public.department_plan_items'),
  ('Approval requests','public.approval_requests'),
  ('Connect conversations','public.connect_conversations'),
  ('Announcements','public.announcements'),
  ('Published recognition results','public.period_recognition_results'),
  ('Calendar occurrences','public.calendar_occurrences'),
  ('Private calendar reminder function','public.calendar_plan_reminders(uuid,timestamptz)'),
  ('Games transactional lobby function','public.games_lobby_command(uuid,uuid,uuid,text,jsonb)'),
  ('Games transactional move function','public.games_commit(uuid,uuid,uuid,integer,jsonb,text,integer)')
), object_state as (
 select name,case when object_name like '%(%' then to_regprocedure(object_name) is not null else to_regclass(object_name) is not null end as present
 from required_objects
)
select name as prerequisite,case when present then 'PRESENT' else 'MISSING' end as state
from object_state order by name;

select 'Private storage bucket' as prerequisite,
       case when exists(select 1 from storage.buckets where id='approval-request-files' and public=false)
         and exists(select 1 from storage.buckets where id='department-plan-files' and public=false)
         then 'PRESENT' else 'MISSING OR NOT PRIVATE' end as state;

select 'Current migration candidate' as information,
       '20261125100000_hod_dashboard_access.sql; never edit or rerun applied migrations' as detail;
