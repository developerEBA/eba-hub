-- Read-only prerequisites for 20261126100000_hod_overview_access.sql.
with required_objects(name, object_name) as (values
  ('HOD active-assignment authorization','eba_private.hod_in_department(uuid,text)'),
  ('HOD dashboard membership authorization','eba_private.hod_dashboard_member(uuid)'),
  ('Published winner profile RPC','public.period_recognition_winner_profiles(text,date)'),
  ('Approval requests','public.approval_requests'),
  ('Department assignments','public.staff_department_assignments'),
  ('Approval request storage policies','storage.objects')
), state as (
  select name,case when object_name like '%(%' then to_regprocedure(object_name) is not null else to_regclass(object_name) is not null end as present
  from required_objects
)
select name as prerequisite,case when present then 'PRESENT' else 'MISSING' end as state from state order by name;
