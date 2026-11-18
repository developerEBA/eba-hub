-- Read-only; run before applying Google import migration after Parts 1-3.
begin transaction read only;
select to_regclass('public.calendar_occurrences') occurrences,
 to_regprocedure('public.calendar_deliver_reminders(timestamptz,integer)') part3_delivery,
 to_regclass('public.google_organizer_connection') organizer_connection;
select conname,pg_get_constraintdef(oid) definition from pg_constraint
 where conrelid='public.calendar_occurrences'::regclass and conname='calendar_occurrences_attendee_ids_check';
select name,has_column_privilege('service_role','auth.users',name,'SELECT') allowed
from unnest(array['id','email','email_confirmed_at','deleted_at','banned_until']) name;
select pg_get_functiondef('public.calendar_enqueue_google()'::regprocedure);
-- Legacy exact-email eligibility only. Zero does NOT mean OAuth is broken.
-- If the EBA Admin email differs, also run google-calendar-import-diagnostic.sql
-- and see the explicit verified owner mapping in docs/google-calendar-import.md.
select count(*) eligible_connected_organizer from public.google_organizer_connection c
 join auth.users u on u.email=c.email where c.enabled and public.calendar_reminder_account_active(u.id);
rollback;
