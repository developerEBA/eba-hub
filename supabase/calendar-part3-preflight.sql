-- READ ONLY. Run before the forward migration; no credentials or meeting details.
begin transaction read only;
select to_regclass('public.calendar_occurrences') occurrences,
  to_regclass('public.calendar_reminders') reminders,to_regclass('public.hub_notifications') notifications,
  to_regprocedure('public.calendar_google_people(uuid[])') google_people;
select t.table_name,t.column_name,
  has_column_privilege('service_role',format('%I.%I',t.table_schema,t.table_name),t.column_name,'SELECT') service_select
from information_schema.columns t where
  (t.table_schema='auth' and t.table_name='users' and t.column_name in ('id','email','email_confirmed_at','deleted_at','banned_until'))
  or (t.table_schema='public' and t.table_name='staff_memberships' and t.column_name in ('user_id','role','status'))
  or (t.table_schema='public' and t.table_name='hub_notifications' and t.column_name in ('id','recipient_id','read_at','created_at'))
order by t.table_schema,t.table_name,t.ordinal_position;
select has_schema_privilege('service_role','auth','USAGE') auth_usage,
 has_sequence_privilege('service_role',pg_get_serial_sequence('public.hub_notifications','id'),'USAGE') notification_identity;
select conname,pg_get_constraintdef(oid) definition from pg_constraint
where conrelid in ('public.calendar_reminders'::regclass,'public.hub_notifications'::regclass) and contype in ('c','u');
select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('calendar_occurrences','calendar_reminders','hub_notifications','connect_conversations');
select count(*) real_department_assignments from public.staff_department_assignments;
select count(*) active_rollout_accounts from public.staff_memberships where status='active' and role in ('ceo','admin');
-- Existing department rooms with NULL member_low are shared, not private groups.
select count(*) shared_conversations from public.connect_conversations where member_low is null;
rollback;
