-- AFTER migration, read-only production checks. No delivery or account changes.
begin transaction read only;
select column_name,has_column_privilege('service_role','auth.users',column_name,'SELECT') allowed
from unnest(array['id','email','email_confirmed_at','deleted_at','banned_until']) column_name;
select has_column_privilege('authenticated','public.calendar_occurrences','reminder_revision','SELECT') revision_read,
  has_table_privilege('authenticated','public.calendar_reminders','SELECT') browser_jobs_must_be_false,
  has_function_privilege('authenticated','public.calendar_deliver_reminders(timestamptz,integer)','EXECUTE') browser_delivery_must_be_false,
  has_function_privilege('service_role','public.calendar_deliver_reminders(timestamptz,integer)','EXECUTE') server_delivery;
select column_name,has_column_privilege('service_role','public.hub_notifications',column_name,'INSERT') allowed
from unnest(array['recipient_id','calendar_occurrence_id','calendar_revision','calendar_lead_minutes','created_at']) column_name;
select has_sequence_privilege('service_role',pg_get_serial_sequence('public.hub_notifications','id'),'USAGE') identity_usage;
select status,lead_minutes,count(*) from public.calendar_reminders where channel='hub' group by status,lead_minutes;
select count(*) duplicate_alert_keys_must_be_zero from (
 select recipient_id,calendar_occurrence_id,calendar_revision,calendar_lead_minutes from public.hub_notifications
 where calendar_occurrence_id is not null group by 1,2,3,4 having count(*)>1
) duplicates;
select count(*) obsolete_unsent_jobs_must_be_zero from public.calendar_reminders j join public.calendar_occurrences o on o.id=j.occurrence_id
where j.status='scheduled' and (o.status='cancelled' or j.schedule_revision<>o.reminder_revision
 or not(j.user_id=o.organizer_id or j.user_id=any(o.attendee_ids)));
rollback;
