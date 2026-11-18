-- READ ONLY. No credentials, meeting contents, writes, recording or live jobs.
begin transaction read only;
select to_regclass('public.game_invites') game_invites,
 to_regprocedure('public.calendar_google_import_owner(text,text)') verified_owner_resolver,
 to_regprocedure('public.calendar_deliver_reminders(timestamptz,integer)') private_reminders;
select conname,pg_get_constraintdef(oid) definition from pg_constraint
 where conrelid='public.hub_notifications'::regclass and conname='hub_notifications_check';
select policyname,qual from pg_policies where schemaname='public' and tablename='calendar_occurrences';
select role,status,count(*) from public.staff_memberships group by role,status;
select department,count(*) assigned_staff from public.staff_department_assignments group by department;
select name,has_column_privilege('service_role','auth.users',name,'SELECT') required_read
 from unnest(array['id','email','email_confirmed_at','deleted_at','banned_until']) name;
select has_sequence_privilege('service_role',pg_get_serial_sequence('public.hub_notifications','id'),'USAGE') notification_identity;
rollback;
